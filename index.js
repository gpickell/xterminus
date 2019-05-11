window.onload = function () {
    let current;
    let ttys = [];
    const resetSymbol = Symbol();
    const termSymbol = Symbol();

    const a = document.createElement('a');
    a.href = "./";

    const baseUrl = "ws://" + a.host + a.pathname;
    Terminal.applyAddon(attach);
    Terminal.applyAddon(fit);

    const theme = {
        background: "rgb(0,0,0)",
        foreground: "rgb(210,210,210)",
        selection: "rgb(100,100,100)",

        black: "rgb(0,0,0)",
        brightBlack: "rgb(85,85,85)",

        red: "rgb(127,0,0)",
        brightRed: "rgb(255,0,0)",

        green: "rgb(0,128,0)",
        brightGreen: "rgb(0,252,0)",

        yellow: "rgb(252,127,0)",
        brightYellow: "rgb(255,255,85)",

        blue: "rgb(0,0,127)",
        brightBlue: "rgb(100,100,255)",
        
        magenta: "rgb(128,0,128)",
        brightMagenta: "rgb(255,85,255)",

        cyan: "rgb(0,147,147)",
        brightCyan: "rgb(0,255,255)",

        white: "rgb(210,210,210)",
        brightWhite: "rgb(255,255,255)"
    };

    function add() {
        const tty = document.createElement("div");
        const caption = document.createElement("div");
        const content = document.createElement("div");
        tty.classList.add("tty");
        caption.classList.add("caption");
        content.classList.add("content");
        tty.appendChild(caption);
        tty.appendChild(content);

        document.body.appendChild(tty);

        const name = "tty" + (ttys.length + 1);
        const url = baseUrl + name;
        const id = (ttys.length + 1) + ": ";

        ttys.push(tty);
        caption.textContent = id + name;

        const term = tty[termSymbol] = new Terminal();
        term.setOption("fontFamily", "Consolas, Monaco, monospace");
        term.setOption("fontSize", 13);
        term.setOption("theme", theme);

        term.open(content);
        term.fit();

        let locked = true;
        term.addOscHandler(0, function (data) {
            if (!locked) {
                locked = true;
                caption.textContent = id + data;
            }
        });

        let socket;
        function notify() {
            const rows = term.rows;
            const cols = term.cols;
            socket.send(`\x1b[0n\x1b[8;${rows};${cols}t`);
        }

        function reset() {
            if (socket) {
                socket.close();
            }

            if (socket === undefined) {
                locked = false;
                socket = new WebSocket(url);
                term.clear();
                term.attach(socket);

                socket.addEventListener("open", function () {
                    notify();
                });

                socket.addEventListener("close", function () {
                    term.detach(socket);
                    term.write("\r\n\r\nDisconnect.\r\nPress ALT-R to restart.\r\n");
                    socket = undefined;
                });
            }
        }

        reset();
        tty[resetSymbol] = reset;

        addEventListener("resize", function () {
            const right = tty.style.right;
            const bottom = tty.style.bottom;
            tty.style.right = "100px";
            tty.style.bottom = "100px";
            term.fit();

            tty.style.right = right;
            tty.style.bottom = bottom;
            term.fit();

            notify();
        });

        if (current === undefined) {
            tty.classList.add("active");
            current = tty;
            term.focus();
            emitHelp();
        }
    }

    function move(dir, index) {
        if (index < ttys.length) {
            index = (index + ttys.length + dir) % ttys.length;
            
            const next = ttys[index];
            if (next !== current) {
                current.classList.remove("active");
                next.classList.add("active");
                current = next;
                current[termSymbol].focus();
                current[termSymbol].scrollToBottom();
            }
        }
    }

    function emitHelp() {
        const term = current[termSymbol];
        term.write("\r\n\x1b[1m\x1b[32mHelp:\r\n");
        term.write("  ALT-1 - ALT-8    Goto tty[n]\r\n");
        term.write("  ALT-LEFT         Goto tty[n-1]\r\n");
        term.write("  ALT-RIGHT        Goto tty[n+1]\r\n");
        term.write("  ALT-F            Full Screen\r\n");
        term.write("  ALT-H            This Help\r\n");
        term.write("\r\n");
        term.write("  CTRL-F1          Site\r\n");
        term.write("  CTRL-F5          Refresh\r\n");
        term.write("\x1b[0m\r\n");
    }

    function interceptKey(e, dir) {
        if (e.ctrlKey) {
            switch (e.key) {
                case "F1":
                    window.open("site", "_blank");
                    break;

                case "F5":
                    location.reload();
                    break;

                default: 
                    return;
            }

            e.stopPropagation();
            e.preventDefault();

            return;
        }
       
        if (e.altKey && ttys.length > 0) {
            switch (e.key) {
                case "ArrowLeft":
                    move(-1, ttys.indexOf(current));
                    break;

                case "ArrowRight":
                    move(1, ttys.indexOf(current));
                    break;

                case "1":
                    move(0, 0);
                    break;

                case "2":
                    move(0, 1);
                    break;

                case "3":
                    move(0, 2);
                    break;

                case "4":
                    move(0, 3);
                    break;

                case "5":
                    move(0, 4);
                    break;

                case "6":
                    move(0, 5);
                    break;

                case "7":
                    move(0, 6);
                    break;

                case "8":
                    move(0, 7);
                    break;

                case "f":
                case "F":
                    document.body.requestFullscreen();
                    break;

                case "r":
                case "R":
                    current[resetSymbol]();
                    break;

                case "h":
                case "H":
                    emitHelp();
                    break;

                default:
                    return;
            }

            e.stopPropagation();
            e.preventDefault();
        }
    }

    addEventListener("keydown", interceptKey, true);

    add();
    add();
    add();
    add();
    add();
    add();
    add();
    add();
}