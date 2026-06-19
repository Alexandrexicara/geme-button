// Servidor do Jogo de Botões 3D - com suporte a salas multiplayer
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const fs = require('fs');
const path = require('path');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let score = 0;

// carregar score salvo
try {
  const data = fs.readFileSync('score.json');
  score = JSON.parse(data).score;
} catch (err) {
  console.log('Criando score inicial');
}

// ===== SALAS MULTIPLAYER =====
const salas = new Map(); // roomId -> { jogadores: [], estado: {} }

function criarSalaId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function enviarEstadoSala(roomId) {
  const sala = salas.get(roomId);
  if (!sala) return;
  io.to(roomId).emit('estadoSala', {
    jogadores: sala.jogadores.map(j => ({ id: j.id, time: j.time, nome: j.nome })),
    placar: sala.placar,
    pronto: sala.jogadores.length === 2 && sala.jogadores.every(j => j.pronto)
  });
}

io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);

  // envia score atual
  socket.emit('scoreUpdate', score);

  socket.on('addScore', (value) => {
    score += value;
    fs.writeFileSync('score.json', JSON.stringify({ score }));
    io.emit('scoreUpdate', score);
  });

  // ===== CRIAR SALA =====
  socket.on('criarSala', (nome) => {
    const roomId = criarSalaId();
    const sala = {
      id: roomId,
      jogadores: [{ id: socket.id, time: 'azul', nome: nome || 'Jogador 1', pronto: false }],
      placar: { azul: 0, vermelho: 0 }
    };
    salas.set(roomId, sala);
    socket.join(roomId);
    socket.emit('salaCriada', { roomId, time: 'azul' });
    console.log(`Sala ${roomId} criada por ${nome || socket.id}`);
  });

  // ===== ENTRAR NA SALA =====
  socket.on('entrarSala', ({ roomId, nome }) => {
    const sala = salas.get(roomId);
    if (!sala) {
      socket.emit('erroSala', 'Sala não encontrada');
      return;
    }
    if (sala.jogadores.length >= 2) {
      socket.emit('erroSala', 'Sala cheia');
      return;
    }
    sala.jogadores.push({ id: socket.id, time: 'vermelho', nome: nome || 'Jogador 2', pronto: false });
    socket.join(roomId);
    socket.emit('salaEntrou', { roomId, time: 'vermelho' });
    enviarEstadoSala(roomId);
    console.log(`${nome || socket.id} entrou na sala ${roomId}`);
  });

  // ===== JOGADOR PRONTO =====
  socket.on('pronto', (roomId) => {
    const sala = salas.get(roomId);
    if (!sala) return;
    const jogador = sala.jogadores.find(j => j.id === socket.id);
    if (jogador) jogador.pronto = true;
    enviarEstadoSala(roomId);
    // Se ambos prontos, iniciar jogo
    if (sala.jogadores.length === 2 && sala.jogadores.every(j => j.pronto)) {
      io.to(roomId).emit('iniciarJogo', {
        placar: sala.placar,
        jogadores: sala.jogadores.map(j => ({ id: j.id, time: j.time, nome: j.nome }))
      });
    }
  });

  // ===== SINCRONIZAR MOVIMENTO DO JOGADOR =====
  socket.on('moverJogador', ({ roomId, jogadorIdx, x, z }) => {
    socket.to(roomId).emit('jogadorMoveu', { jogadorIdx, x, z });
  });

  // ===== SINCRONIZAR CHUTE =====
  socket.on('chuteBola', ({ roomId, velX, velZ }) => {
    socket.to(roomId).emit('bolaChutada', { velX, velZ });
  });

  // ===== SINCRONIZAR GOL =====
  socket.on('golMarcado', ({ roomId, time }) => {
    const sala = salas.get(roomId);
    if (!sala) return;
    sala.placar[time]++;
    io.to(roomId).emit('golAtualizado', { placar: sala.placar, time });
  });

  // ===== SAIR DA SALA =====
  socket.on('sairSala', (roomId) => {
    const sala = salas.get(roomId);
    if (!sala) return;
    sala.jogadores = sala.jogadores.filter(j => j.id !== socket.id);
    if (sala.jogadores.length === 0) {
      salas.delete(roomId);
      console.log(`Sala ${roomId} deletada`);
    } else {
      io.to(roomId).emit('jogadorSaiu', socket.id);
      enviarEstadoSala(roomId);
    }
  });

  // ===== LISTAR SALAS =====
  socket.on('listarSalas', () => {
    const lista = [];
    for (const [id, sala] of salas) {
      lista.push({ id, jogadores: sala.jogadores.length, nomes: sala.jogadores.map(j => j.nome) });
    }
    socket.emit('listaSalas', lista);
  });

  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
    // Remover de todas as salas
    for (const [roomId, sala] of salas) {
      const idx = sala.jogadores.findIndex(j => j.id === socket.id);
      if (idx >= 0) {
        sala.jogadores.splice(idx, 1);
        if (sala.jogadores.length === 0) {
          salas.delete(roomId);
        } else {
          io.to(roomId).emit('jogadorSaiu', socket.id);
          enviarEstadoSala(roomId);
        }
      }
    }
  });
});

app.get('/api/scores', (req, res) => {
  res.json({ score });
});

server.listen(8000, () => {
  console.log('Server rodando na porta 8000');
});