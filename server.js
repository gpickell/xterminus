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
                console.log(fn);
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
        console.log(configPath1);
        return configPath1;
    }

    if (fs.existsSync(configPath2)) {
        console.log(configPath2);
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

function isLocal(origin) {
    console.log(origin);
    if (origin === "http://localhost") {
        return true;
    }

    if (origin.indexOf("http://localhost:") === 0) {
        return true;
    }

    if (origin.indexOf("http://172.") === 0) {
        return true;
    }

    return false;
}

const ws = new WebSocketServer({ server });
ws.on("connection", function (socket, request) {
    if (!isLocal(request.headers.origin)) {
        socket.terminate();
    }

    let p;
    const id = request.url.substr(1);
    function launch(rows, cols) {
        if (p === undefined) {
            try {
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

                p.on("data", function (data) {
                    if (socket !== undefined) {
                        socket.send(data);
                    }
                });

                p.on("exit", function () {
                    p = undefined;

                    if (socket !== undefined) {
                        socket.close();
                    }
                });
            } catch (ex) {
                console.log("Launch Error: %o", ex);
                socket.send("Launch Error: " + ex);
                socket.close();
            }
        } else {
            p.resize(cols, rows);
        }
    }

    socket.on("close", function () {
        if (p !== undefined) {
            p.kill(os.platform() !== "win32" ? "SIGKILL" : undefined);
            p = undefined;
        }
    });

    const init = /^\x1b\[0n\x1b\[8;(\d+);(\d+)t$/;
    socket.on("message", function (data) {
        const match = data.match(init);
        if (match !== null) {
            const rows = Number(match[1]);
            const cols = Number(match[2]);
            launch(rows, cols);
        } else if (p !== undefined) {
            p.write(data);
        }
    });
});

const port = Number(env.xterminus_port || 13080);
console.log("Listening: port=" + port);
server.listen(port);
