'use client';
import React, { useState, useEffect } from 'react';
import { useGameStore, TimeId } from '@/store/useGameStore';
import Image from 'next/image';

const TIMES = {
  cruzeiro: { nome: 'Cruzeiro',    emoji: '🦊', cor: '#003b8e', corBrilho: 'rgba(0,80,200,0.35)', img: '/cruzeiro.png' },
  atletico: { nome: 'Atlético-MG', emoji: '🐓', cor: '#444',    corBrilho: 'rgba(80,80,80,0.35)',  img: '/atletico.png' },
};

const HUD: React.FC = () => {
  const { gameState, placar, setMeuTime, meuTime } = useGameStore();
  const [selecionado, setSelecionado] = useState<TimeId | null>(null);
  const [turnoAtual, setTurnoAtual]   = useState<TimeId | null>(null);
  const [faseJogada, setFaseJogada]   = useState<string>('IDLE');
  const [pisca, setPisca]             = useState(true);

  // Lê o turno atual do GameCanvas via window (polling leve)
  useEffect(() => {
    if (gameState !== 'PLAYING') return;
    const id = setInterval(() => {
      const w = window as unknown as { _turnoAtual?: string; _faseJogada?: string };
      if (w._turnoAtual) setTurnoAtual(w._turnoAtual as TimeId);
      if (w._faseJogada) setFaseJogada(w._faseJogada);
    }, 100);
    return () => clearInterval(id);
  }, [gameState]);

  // Pisca o indicador "sua vez"
  useEffect(() => {
    const id = setInterval(() => setPisca(p => !p), 600);
    return () => clearInterval(id);
  }, []);

  const confirmar = () => {
    if (!selecionado) return;
    setMeuTime(selecionado);
    const tentarIniciar = (tentativas = 0) => {
      const fn = (window as unknown as { _iniciarJogoBtn?: (t: TimeId) => void })._iniciarJogoBtn;
      if (fn) {
        fn(selecionado);
      } else if (tentativas < 20) {
        setTimeout(() => tentarIniciar(tentativas + 1), 150);
      }
    };
    tentarIniciar();
  };

  // ── Tela de seleção de time ──────────────────────────────────
  if (gameState === 'START') {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-auto"
        style={{ background: 'linear-gradient(160deg,#0a1628 0%,#1a3a5c 55%,#0a0a0a 100%)' }}>

        <h1 style={{ color: '#ffd700', fontSize: 36, fontWeight: 900, letterSpacing: 1, marginBottom: 4 }}>
          ⚽ Jogo de Botões 3D
        </h1>
        <p style={{ color: '#aaa', fontSize: 15, marginBottom: 28 }}>Clássico Mineiro — Brasileirão</p>

        <p style={{ color: '#ffd700', fontSize: 18, fontWeight: 700, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 2 }}>
          Escolha seu time
        </p>

        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 28 }}>
          {(Object.keys(TIMES) as TimeId[]).map(tid => {
            const cfg = TIMES[tid];
            const sel = selecionado === tid;
            return (
              <button key={tid} onClick={() => setSelecionado(tid)} style={{
                background: sel ? cfg.corBrilho : 'rgba(255,255,255,0.05)',
                border: `3px solid ${sel ? '#fff' : '#444'}`,
                borderRadius: 18, padding: '22px 34px', cursor: 'pointer',
                textAlign: 'center', minWidth: 170, transition: 'all .25s',
                transform: sel ? 'scale(1.08)' : 'scale(1)',
                boxShadow: sel ? `0 0 28px ${cfg.cor}99` : 'none',
              }}>
                <Image src={cfg.img} alt={cfg.nome} width={100} height={100}
                  style={{ objectFit: 'contain', display: 'block', margin: '0 auto 10px' }} />
                <div style={{ color: tid === 'cruzeiro' ? '#4488ff' : '#ddd', fontSize: 18, fontWeight: 700 }}>
                  {cfg.nome}
                </div>
                <div style={{ color: '#888', fontSize: 13, marginTop: 3 }}>{cfg.emoji}</div>
              </button>
            );
          })}
        </div>

        <button onClick={confirmar} disabled={!selecionado} style={{
          padding: '14px 44px', borderRadius: 12, fontSize: 18, fontWeight: 700,
          border: '2px solid #ffd700',
          background: selecionado ? 'rgba(255,215,0,0.18)' : 'rgba(255,215,0,0.04)',
          color: selecionado ? '#ffd700' : '#555',
          cursor: selecionado ? 'pointer' : 'default', transition: 'all .2s',
        }}>▶ Jogar!</button>

        {/* Instruções */}
        <div style={{ marginTop: 28, maxWidth: 420, textAlign: 'center',
          background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '14px 20px' }}>
          <p style={{ color: '#ffd700', fontWeight: 700, marginBottom: 8 }}>Como jogar:</p>
          <p style={{ color: '#ccc', fontSize: 13, lineHeight: 1.7 }}>
            1. <b style={{ color:'#fff' }}>Clique</b> no botão do seu time para selecionar<br/>
            2. <b style={{ color:'#fff' }}>Mova o mouse</b> para apontar a direção<br/>
            3. <b style={{ color:'#fff' }}>Clique novamente</b> para lançar o botão<br/>
            4. Os times jogam <b style={{ color:'#fff' }}>alternadamente</b><br/>
            5. Após cada jogada os jogadores <b style={{ color:'#fff' }}>se reposicionam</b><br/>
            <span style={{ color:'#888', fontSize:12 }}>Botão direito = girar câmera | Scroll = zoom</span>
          </p>
        </div>
      </div>
    );
  }

  if (gameState !== 'PLAYING') return null;

  // ── HUD em jogo ──────────────────────────────────────────────
  const adversario: TimeId = meuTime === 'cruzeiro' ? 'atletico' : 'cruzeiro';
  const cfgMeu = TIMES[meuTime];
  const cfgAdv = TIMES[adversario];
  const isMinhaVez = turnoAtual === meuTime;
  const iaDeslizando = faseJogada === 'DESLIZANDO' && !isMinhaVez;
  const redistribuindo = faseJogada === 'DESLIZANDO' && turnoAtual !== meuTime && turnoAtual !== adversario;

  // Mensagem de instrução por fase
  const instrucao = (() => {
    if (faseJogada === 'IA_PENSANDO')  return `🤖 ${cfgAdv.nome} está pensando...`;
    if (faseJogada === 'DESLIZANDO' && !isMinhaVez) return `⚡ ${cfgAdv.nome} jogou!`;
    if (faseJogada === 'DESLIZANDO' && isMinhaVez)  return `⚽ Em movimento...`;
    if (!isMinhaVez) return `⏳ Vez do ${cfgAdv.nome}`;
    if (faseJogada === 'IDLE') return `${cfgMeu.emoji} Clique num botão seu para jogar`;
    if (faseJogada === 'MIRA') return `🎯 Aponte e clique para lançar`;
    return '';
  })();

  // Cor/estilo do banner de turno
  const turnoStyle = isMinhaVez
    ? { bg: 'rgba(0,70,0,0.9)', border: '#44ff88', cor: '#88ffaa', pulso: pisca }
    : { bg: 'rgba(70,0,0,0.85)', border: '#ff4444', cor: '#ff8888', pulso: false };

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-50">

      {/* ── Placar ── */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.92)', border: '2px solid #ffd700', borderRadius: 14,
        padding: '7px 22px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      }}>
        <Image src={cfgMeu.img} alt={cfgMeu.nome} width={32} height={32} style={{ objectFit: 'contain' }} />
        <span style={{ color: '#aaa', fontSize: 13 }}>{cfgMeu.nome}</span>
        <span style={{ color: '#ffd700', fontSize: 30, fontWeight: 900, minWidth: 24, textAlign: 'center' }}>
          {placar[meuTime]}
        </span>
        <span style={{ color: '#444', fontSize: 20 }}>×</span>
        <span style={{ color: '#ffd700', fontSize: 30, fontWeight: 900, minWidth: 24, textAlign: 'center' }}>
          {placar[adversario]}
        </span>
        <span style={{ color: '#aaa', fontSize: 13 }}>{cfgAdv.nome}</span>
        <Image src={cfgAdv.img} alt={cfgAdv.nome} width={32} height={32} style={{ objectFit: 'contain' }} />
      </div>

      {/* ── Indicador de turno com pulso ── */}
      <div style={{
        position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)',
        background: turnoStyle.bg,
        border: `2px solid ${turnoStyle.border}`,
        borderRadius: 10, padding: '6px 20px',
        color: turnoStyle.cor,
        fontSize: 15, fontWeight: 800,
        opacity: isMinhaVez && pisca ? 1 : (isMinhaVez ? 0.75 : 1),
        transition: 'opacity .2s, background .4s',
        letterSpacing: 1,
        whiteSpace: 'nowrap',
      }}>
        {isMinhaVez
          ? `${cfgMeu.emoji} SUA VEZ — ${cfgMeu.nome.toUpperCase()}`
          : `${cfgAdv.emoji} VEZ DO ${cfgAdv.nome.toUpperCase()}`}
      </div>

      {/* ── Instrução de fase ── */}
      {instrucao && (
        <div style={{
          position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.82)', color: '#ddd',
          border: `1px solid ${isMinhaVez ? '#ffd70088' : '#55555588'}`,
          borderRadius: 9, padding: '8px 22px', fontSize: 14,
          fontWeight: isMinhaVez && faseJogada === 'IDLE' ? 700 : 400,
          transition: 'all .3s', whiteSpace: 'nowrap',
          boxShadow: isMinhaVez && faseJogada === 'IDLE' ? '0 0 18px rgba(255,215,0,0.25)' : 'none',
        }}>
          {instrucao}
        </div>
      )}

      {/* ── Badge meu time (canto esquerdo) ── */}
      <div style={{
        position: 'absolute', top: 12, left: 14,
        display: 'flex', alignItems: 'center', gap: 7,
      }}>
        <Image src={cfgMeu.img} alt={cfgMeu.nome} width={36} height={36} style={{ objectFit: 'contain' }} />
        <span style={{
          color: '#ddd', fontSize: 11,
          background: 'rgba(0,0,0,0.72)', padding: '3px 8px', borderRadius: 7,
          border: '1px solid #333',
        }}>
          Você: {cfgMeu.nome}
        </span>
      </div>

      {/* ── Redistribuindo (jogadores se movendo) ── */}
      {iaDeslizando && (
        <div style={{
          position: 'absolute', top: 112, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', color: '#aaa',
          border: '1px solid #333', borderRadius: 8,
          padding: '4px 14px', fontSize: 12,
        }}>
          🔄 jogadores se reposicionando...
        </div>
      )}

    </div>
  );
};

export default HUD;
