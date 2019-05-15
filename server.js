const child_process = require("child_process");
const WebSocketServer = require("ws").Server;
const http = require("http");
const express = require("express");
const path = require("path");
const { PassThrough } = require("stream");
const readline = require("readline");
const os = require("os");
const pty = require("node-pty");
const fs = require("fs");
const URL = require("url");
const minimatch = require("minimatch");

if (os.platform() === "linux") {
    process.env.SHELL = "/bin/bash";
}

const env = {};
for (const key in process.env) {
    env[key.toLowerCase()] = process.env[key];
}

function searchPaths(name) {
    const paths = env.path.replace(/:[/\\]?/g, function (x) {
        return x.length > 1 ? x : ";";
    });

    const sysPaths = env.path.split(';');
    const candidates = [name];
    if (os.platform() === "win32") {
        candidates.pop();
        candidates.push(name + ".exe", name + ".cmd");
    }

    for (const sysPath of sysPaths) {
        for (const cand of candidates) {
            const fn = path.join(sysPath, cand);
            if (fs.existsSync(fn)) {
                return fn;
            }
        }
    }

    return name;
}

const basename = path.basename(process.cwd());
const configPath1 = path.normalize(path.join(process.cwd(), ".xterminus.json"));
const configPath2 = path.normalize(path.join(process.cwd(), `../.xterminus.${basename}.json`));
function findConfig() {
    if (fs.existsSync(configPath1)) {
        return configPath1;
    }

    if (fs.existsSync(configPath2)) {
        return configPath2;
    }

    return undefined;
}

function makeCommand(id) {
    const template = {
        title: "Shell",
        spawn: os.platform() === "win32" ? "cmd.exe" : "bash",
        args: [],
        cwd: process.cwd()
    };

    const configPath = findConfig();
    if (configPath === undefined) {
        return template;
    }

    function makeCommand(cmd, template) {
        cmd = cmd || {};

        return {
            ...template,
            ...cmd,
            cwd: path.normalize(path.join(template.cwd, cmd.cwd || "."))
        };
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const cmd = config[id];
    const shell = makeCommand(config.shell, template);
    return makeCommand(cmd, shell);
}

const app = express();

app.use(express.static(__dirname));
console.log(__dirname);

const xtermPath = path.normalize(path.join(require.resolve("xterm/package.json"), "../dist"));
app.use(express.static(xtermPath));
console.log(xtermPath);

const sitePath = path.normalize(path.join(process.cwd(), ".site"));
app.use("/site", express.static(sitePath));
console.log(sitePath);

const server = http.createServer();
server.on("request", app);

const safeIpRange = /^(::ffff:)?172\.(1[6-9]|2[0-9]|3[01])\./;
function isLocal(request) {
    const { host } = URL.parse(request.headers.origin);
    if (request.headers.host !== host) {
        return false;
    }

    const addr = request.socket.localAddress;
    if (addr === "::1") {
        return true;
    }

    if (addr.indexOf("127.") === 0) {
        return true;
    }

    if (safeIpRange.test(addr)) {
        return true;
    }

    return false;
}

const watcher = fs.watch(process.cwd(), {
    recursive: true,
    encoding: "utf8"
});

let debounceTimer;
let delayTimer;
function debounceMaybe() {
    delayTimer = undefined;

    if (debounceTimer === undefined) {
        watcher.emit("debounce");
    }
}

function debounceProbably() {
    debounceTimer = undefined;

    if (delayTimer === undefined) {
        watcher.emit("debounce");
        delayTimer = setTimeout(debounceMaybe, 1000);
    }
}

watcher.on("newListener", function (event, listener) {
    if (event === "debounce") {
        if (debounceTimer !== undefined) {
            clearTimeout(debounceTimer);
        }

        this.off("debounce", listener);
        debounceTimer = setTimeout(debounceProbably, 300);
    }
});

function serve(socket, id) {
    let p;
    let rows;
    let cols;
    let globs;
    function kill() {
        const temp = p;
        if (temp !== undefined) {
            p = undefined;
            temp.kill(os.platform() !== "win32" ? "SIGKILL" : undefined);
        }
    }

    function close() {
        watcher.off("debounce", relaunch);
        watcher.off("change", observe);
        socket.removeAllListeners();
        socket.close();
    }

    function launch() {
        const cmd = makeCommand(id);
        console.log("Launch: %s %s %o", cols, rows, cmd);

        const fn = cmd.npm ? "npm" : cmd.spawn;
        const args = cmd.npm ? ["run", cmd.npm] : cmd.args;
        p = pty.spawn(searchPaths(fn), args, {
            name: "xterm-color",
            rows,
            cols,
            env: process.env,
            cwd: cmd.cwd
        });

        const info = args.join(" ");
        socket.send(`\x1b]0;${cmd.title}\x1b\\`);
        socket.send(`\x1b[1m\x1b[37mXTerminus: ${fn} ${info}\x1b[0m\r\n\r\n`);

        const me = p;
        p.on("data", function (data) {
            if (p === me) {
                socket.send(data);
            }
        });

        p.on("exit", function () {
            if (p === me) {
                close();
            }
        });

        globs = cmd.watch;
        if (typeof globs === "string") {
            globs = [globs];
        }

        if (!Array.isArray(globs)) {
            globs = [];
        }

        watcher.on("change", observe);
    }

    function trylaunch() {
        try {
            launch();
        } catch (ex) {
            console.log("Launch Error: %o", ex);
            socket.send("Launch Error: " + ex);
            close();
        }
    }

    function relaunch() {
        socket.send(`\x1b[1m\x1b[32m\r\n=== Restart ===\x1b[0m\r\n`);
        kill();
        trylaunch();
    }

    function observe(type, fn) {
        if (fn && globs.some(x => minimatch(fn, x))) {
            watcher.once("debounce", relaunch);
        }
    }

    socket.on("close", function () {
        kill();
        close();
    });

    const init = /^\x1b\[0n\x1b\[8;(\d+);(\d+)t$/;
    socket.on("message", function (data) {
        const match = data.match(init);
        if (match !== null) {
            rows = Number(match[1]);
            cols = Number(match[2]);
            if (p === undefined) {
                trylaunch();
            } else {
                p.resize(cols, rows);
            }
        } else if (p !== undefined) {
            p.write(data);
        }
    });
}

const ws = new WebSocketServer({ server });
ws.on("connection", function (socket, request) {
    if (isLocal(request)) {
        serve(socket, request.url.substr(1));
    } else {
        socket.terminate();
    }
});

const port = Number(env.xterminus_port || 13080);
console.log("Listening: port=" + port);
server.listen(port);
