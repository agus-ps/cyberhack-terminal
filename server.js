// server.js
const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public')); // carpeta con tu HTML/CSS/JS

const server = app.listen(3000, () => {
  console.log('HTTP server running on http://localhost:3000');
});

const wss = new WebSocket.Server({ server });

// Lista blanca de comandos permitidos (solo ejecutables)
const ALLOWED_CMDS = new Set(['nmap', 'gobuster', 'hydra', 'nuclei', 'ffuf']);

function isAllowed(command) {
  const exe = command.trim().split(/\s+/)[0];
  return ALLOWED_CMDS.has(exe);
}

const COMMAND_TIMEOUT = 2 * 60 * 1000; // 2 minutos

wss.on('connection', (ws) => {
  console.log('Nuevo cliente WS conectado');

  ws.on('message', (raw) => {
    let payload;
    try { payload = JSON.parse(raw); } catch (e) {
      ws.send(JSON.stringify({ info: 'JSON inválido' }));
      return;
    }

    const { command, id } = payload;
    if (!command) {
      ws.send(JSON.stringify({ info: 'No se recibió comando', reply_id: id || null }));
      return;
    }

    if (!isAllowed(command)) {
      ws.send(JSON.stringify({
        info: `Comando no permitido: ${command.trim().split(/\s+/)[0]}`,
        reply_id: id || null
      }));
      return;
    }

    const child = spawn(command, { shell: true });

    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      try {
        ws.send(JSON.stringify({ type: 'stderr', data: 'Proceso terminado por timeout', reply_id: id || null }));
        ws.send(JSON.stringify({ type: 'close', code: 137, reply_id: id || null }));
      } catch (e) {}
    }, COMMAND_TIMEOUT);

    child.stdout.on('data', (chunk) => {
      try { ws.send(JSON.stringify({ type: 'stdout', data: chunk.toString(), reply_id: id || null })); } catch (e) {}
    });

    child.stderr.on('data', (chunk) => {
      try { ws.send(JSON.stringify({ type: 'stderr', data: chunk.toString(), reply_id: id || null })); } catch (e) {}
    });

    child.on('error', (err) => {
      try { ws.send(JSON.stringify({ type: 'stderr', data: err.message, reply_id: id || null })); } catch (e) {}
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      try { ws.send(JSON.stringify({ type: 'close', code, reply_id: id || null })); } catch (e) {}
    });
  });

  ws.on('close', () => {
    console.log('Cliente WS desconectado');
  });

  ws.on('error', (err) => {
    console.error('WS error:', err && err.message ? err.message : err);
  });
});
