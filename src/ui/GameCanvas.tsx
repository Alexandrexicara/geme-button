'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useGameStore, TimeId } from '@/store/useGameStore';

const TIMES: Record<TimeId, { nome: string; emoji: string; cor: number; corBorda: number; img: string }> = {
  cruzeiro: { nome: 'Cruzeiro',    emoji: '🦊', cor: 0x003b8e, corBorda: 0x88aaff, img: '/cruzeiro.png' },
  atletico: { nome: 'Atlético-MG', emoji: '🐓', cor: 0x1a1a1a, corBorda: 0xaaaaaa, img: '/atletico.png' },
};

type FaseJogada = 'IDLE' | 'MIRA' | 'DESLIZANDO' | 'IA_PENSANDO';

const BOTAO_VEL   = 0.24;
const ATRITO      = 0.905;
const BOLA_ATRITO = 0.968;
const MIN_VEL     = 0.014;

const GameCanvas: React.FC = () => {
  const mountRef    = useRef<HTMLDivElement>(null);
  const sceneRef    = useRef<THREE.Scene | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef    = useRef<number>(0);

  const gs = useRef({
    meuTime:    'cruzeiro' as TimeId,
    adversario: 'atletico' as TimeId,
    jogoAtivo:  false,
    gameActive: true,
    turno:      'cruzeiro' as TimeId,
    fase:       'IDLE' as FaseJogada,
    camDist: 36, camH: 0, camV: 0.82,
    camRotating: false,
    rotStart: { x: 0, y: 0 },
    botaoSel:     null as THREE.Group | null,
    dirSeta:      new THREE.Vector3(1, 0, 0),
    potencia:     1 as number,
    botaoMovendo: null as THREE.Group | null,
    botaoVelVec:  new THREE.Vector3(),
    redistribuindo:  false,
    jogadaEncerrada: false,
  });

  const bolaRef      = useRef<THREE.Mesh | null>(null);
  const bolaVel      = useRef(new THREE.Vector3());
  const lastFrameRef  = useRef<number | null>(null);
  const executarJogadaIARef = useRef<() => void>(() => {});
  const jogadoresRef = useRef<THREE.Group[]>([]);
  const goleirosRef  = useRef<THREE.Group[]>([]);
  const texRef       = useRef<Record<TimeId, THREE.Texture | null>>({ cruzeiro: null, atletico: null });
  const setaRef      = useRef<THREE.ArrowHelper | null>(null);
  const raycaster    = useRef(new THREE.Raycaster());
  const mouse2d      = useRef(new THREE.Vector2());
  const confetesRef  = useRef<THREE.Mesh[]>([]);
  const confeteAtivo = useRef(false);

  const { setGameState, addGol } = useGameStore();

  // ─── Áudio ───────────────────────────────────────────────────
  const audioCtx = useRef<AudioContext | null>(null);
  const getAudio = () => {
    if (!audioCtx.current)
      audioCtx.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    return audioCtx.current;
  };
  const beep = useCallback((freq: number, dur: number, tipo: OscillatorType = 'sine') => {
    try {
      const ctx = getAudio();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = tipo; o.frequency.value = freq;
      g.gain.setValueAtTime(0.25, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (_) {}
  }, []);

  const somSelecao  = useCallback(() => beep(440, 0.08, 'square'), [beep]);
  const somConfirma = useCallback(() => beep(600, 0.12, 'square'), [beep]);
  const somChute    = useCallback(() => { beep(300, 0.1, 'sawtooth'); setTimeout(() => beep(200, 0.08), 60); }, [beep]);
  const somGol      = useCallback(() => {
    beep(523, 0.18); setTimeout(() => beep(659, 0.18), 200);
    setTimeout(() => beep(784, 0.18), 400); setTimeout(() => beep(1047, 0.35), 600);
  }, [beep]);
  const somTorcida  = useCallback(() => {
    for (let i = 0; i < 8; i++)
      setTimeout(() => beep(180 + Math.random() * 320, 0.25, 'sawtooth'), i * 80);
  }, [beep]);

  // ─── Confetes ────────────────────────────────────────────────
  const lancarConfetes = useCallback(() => {
    const scene = sceneRef.current!;
    confeteAtivo.current = true;
    const cores = [0xff2222, 0x2266ff, 0xffdd00, 0x22ff88, 0xff88ff, 0xffffff, 0xff8800];
    for (let i = 0; i < 150; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.14),
        new THREE.MeshBasicMaterial({ color: cores[i % cores.length], side: THREE.DoubleSide })
      );
      m.position.set((Math.random()-.5)*30, 9+Math.random()*5, (Math.random()-.5)*20);
      m.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      m.userData.vy = -(0.04 + Math.random()*0.05);
      m.userData.vx = (Math.random()-.5)*0.04;
      m.userData.sp = (Math.random()-.5)*0.1;
      scene.add(m); confetesRef.current.push(m);
    }
    setTimeout(() => {
      confetesRef.current.forEach(c => scene.remove(c));
      confetesRef.current = []; confeteAtivo.current = false;
    }, 3800);
  }, []);

  const tickConfetes = useCallback(() => {
    if (!confeteAtivo.current) return;
    /* eslint-disable react-hooks/immutability -- Three.js objects live outside React state. */
    for (const c of confetesRef.current) {
      c.position.y += c.userData.vy;
      c.position.x += c.userData.vx;
      c.rotation.z += c.userData.sp;
      if (c.position.y < -1) c.position.y = 10;
    }
    /* eslint-enable react-hooks/immutability */
  }, []);

  // ─── Câmera ──────────────────────────────────────────────────
  const atualizarCamera = useCallback(() => {
    const cam = cameraRef.current!;
    const { camDist, camH, camV } = gs.current;
    cam.position.set(
      camDist * Math.sin(camH) * Math.cos(camV),
      camDist * Math.sin(camV),
      camDist * Math.cos(camH) * Math.cos(camV)
    );
    cam.lookAt(0, 0, 0);
  }, []);

  // ─── Criar botão ─────────────────────────────────────────────
  const criarBotao = useCallback((x: number, z: number, timeId: TimeId, ehGoleiro: boolean): THREE.Group => {
    const cfg = TIMES[timeId];
    const tex = texRef.current[timeId];
    const g   = new THREE.Group();
    const r   = ehGoleiro ? 1.0 : 0.85;
    const h   = ehGoleiro ? 0.58 : 0.48;

    const corpo = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 28),
      new THREE.MeshStandardMaterial({ color: cfg.cor, metalness: 0.3, roughness: 0.45 })
    );
    corpo.castShadow = true;
    g.add(corpo);

    const topo = new THREE.Mesh(
      new THREE.CylinderGeometry(r*.88, r*.88, 0.06, 28),
      new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: 0xffffff })
    );
    topo.position.y = h/2 + 0.03;
    g.add(topo);

    const borda = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.07, 8, 28),
      new THREE.MeshStandardMaterial({ color: ehGoleiro ? 0xc0c0c0 : cfg.corBorda, metalness: 0.85 })
    );
    borda.rotation.x = Math.PI/2;
    borda.position.y = h/2;
    g.add(borda);

    const yBase = ehGoleiro ? 0.29 : 0.24;
    g.position.set(x, yBase, z);
    g.userData = { posInicial: { x, z }, timeId, ehGoleiro, vel: new THREE.Vector3(), destino: null };

    sceneRef.current!.add(g);
    jogadoresRef.current.push(g);
    if (ehGoleiro) goleirosRef.current.push(g);
    return g;
  }, []);

  // ─── Criar times ─────────────────────────────────────────────
  // Início: cada time todo no seu próprio campo (atrás da linha do meio)
  // Jogador: lado esquerdo (x negativo), ataca para +x
  // IA:      lado direito  (x positivo), ataca para -x
  const criarTimes = useCallback(() => {
    jogadoresRef.current.forEach(j => sceneRef.current!.remove(j));
    jogadoresRef.current = []; goleirosRef.current = [];
    const { meuTime, adversario } = gs.current;

    criarBotao(-11, -3,  meuTime, false);
    criarBotao(-11,  3,  meuTime, false);
    criarBotao( -8, -5,  meuTime, false);
    criarBotao( -8,  5,  meuTime, false);
    criarBotao( -2,  0,  meuTime, false);

    criarBotao( 11, -3,  adversario, false);
    criarBotao( 11,  3,  adversario, false);
    criarBotao(  8, -5,  adversario, false);
    criarBotao(  8,  5,  adversario, false);
    criarBotao(  2,  0,  adversario, false);

    criarBotao(-13.5, 0, meuTime,    true);
    criarBotao( 13.5, 0, adversario, true);
  }, [criarBotao]);

  // ─── Seta de mira ────────────────────────────────────────────
  const atualizarSeta = useCallback((dir: THREE.Vector3) => {
    const scene = sceneRef.current!;
    if (setaRef.current) { scene.remove(setaRef.current); setaRef.current = null; }
    const botao = gs.current.botaoSel;
    if (!botao) return;
    const orig = botao.position.clone(); orig.y = 0.7;
    const length = 2.5 + gs.current.potencia * 3.5;
    setaRef.current = new THREE.ArrowHelper(dir, orig, length, 0xffff00, 0.9, 0.55);
    scene.add(setaRef.current);
  }, []);

  const removerSeta = useCallback(() => {
    if (setaRef.current) { sceneRef.current!.remove(setaRef.current); setaRef.current = null; }
  }, []);

  // ─── Mouse → plano Y=0 ───────────────────────────────────────
  const mouseToPlane = useCallback((ex: number, ey: number): THREE.Vector3 | null => {
    mouse2d.current.x =  (ex / window.innerWidth)  * 2 - 1;
    mouse2d.current.y = -(ey / window.innerHeight) * 2 + 1;
    raycaster.current.setFromCamera(mouse2d.current, cameraRef.current!);
    const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return raycaster.current.ray.intersectPlane(plano, pt) ? pt : null;
  }, []);

  // ─── Resetar posições ────────────────────────────────────────
  const resetarPosicoes = useCallback(() => {
    jogadoresRef.current.forEach(j => {
      const { x, z } = j.userData.posInicial;
      j.position.set(x, j.userData.ehGoleiro ? 0.29 : 0.24, z);
      j.userData.vel.set(0, 0, 0);
      j.userData.destino = null;
    });
    bolaRef.current!.position.set(0, 0.5, 0);
    bolaVel.current.set(0, 0, 0);
    const s = gs.current;
    s.fase = 'IDLE'; s.botaoSel = null; s.botaoMovendo = null; s.potencia = 1;
    s.botaoVelVec.set(0, 0, 0);
    s.redistribuindo = false; s.jogadaEncerrada = false;
    removerSeta();
  }, [removerSeta]);

  // ─── Verificar gol ───────────────────────────────────────────
  const verificarGol = useCallback((dispatchGol: (t: TimeId) => void) => {
    const s = gs.current;
    if (!s.gameActive) return;
    const bola = bolaRef.current!;
    const marcarGol = (time: TimeId) => {
      s.gameActive = false; s.fase = 'IDLE';
      s.botaoSel = null; s.botaoMovendo = null;
      removerSeta();
      somGol(); somTorcida(); lancarConfetes();
      dispatchGol(time);
      bola.position.set(0, 0.5, 0);
      bolaVel.current.set(0, 0, 0);
      const novoPlacar = useGameStore.getState().placar[time] + 1;
      if (novoPlacar >= 3) {
        setGameState('VICTORY');
        return;
      }
      setTimeout(() => {
        resetarPosicoes();
        // Após um gol, a saída é do adversário de quem marcou.
        s.turno = time === s.meuTime ? s.adversario : s.meuTime;
        s.gameActive = true;
        if (s.turno === s.adversario) {
          s.fase = 'IA_PENSANDO';
          setTimeout(() => executarJogadaIARef.current(), 700);
        }
      }, 2800);
    };
    if (bola.position.x < -14.5 && Math.abs(bola.position.z) < 3.1) marcarGol(s.adversario);
    if (bola.position.x >  14.5 && Math.abs(bola.position.z) < 3.1) marcarGol(s.meuTime);
  }, [removerSeta, resetarPosicoes, somGol, somTorcida, lancarConfetes, setGameState]);

  // ─── Redistribuir jogadores ──────────────────────────────────
  // Define destinos táticos em userData.destino — o loop move frame a frame
  const redistribuirJogadores = useCallback(() => {
    const s = gs.current;
    if (s.redistribuindo) return;
    s.redistribuindo = true;

    const bx = bolaRef.current!.position.x;
    const bn = Math.max(-1, Math.min(1, bx / 12)); // -1..+1

    // Time do JOGADOR (esquerdo, ataca +x)
    // defesa fica atrás, meio no centro, atacante avança para campo adversário
    const destJog: [number, number][] = [
      [-11 + bn * 1,  -3.5],
      [-11 + bn * 1,   3.5],
      [ -3 + bn * 2,  -5  ],
      [ -3 + bn * 2,   5  ],
      [  5 + bn * 2,   0  ],
    ];
    // ADVERSÁRIO (direito, ataca -x) — espelho
    const destIA: [number, number][] = [
      [ 11 - bn * 1,  -3.5],
      [ 11 - bn * 1,   3.5],
      [  3 - bn * 2,  -5  ],
      [  3 - bn * 2,   5  ],
      [ -5 - bn * 2,   0  ],
    ];

    // Jogador mais perto da bola de cada time vai ATÉ a bola, os outros redistribuem
    const bolaPos = bolaRef.current!.position;

    const applyTime = (team: THREE.Group[], dests: [number, number][], atacaParaDireita: boolean) => {
      let maisProximo: THREE.Group | null = null;
      let menorDist = Infinity;
      for (const j of team) {
        const d = j.position.distanceTo(bolaPos);
        if (d < menorDist) { menorDist = d; maisProximo = j; }
      }
      team.forEach((j, i) => {
        if (j === maisProximo) {
          // Posiciona atrás da bola em relação ao gol que ataca
          // Se ataca para direita (+x): vem pelo lado esquerdo da bola (-x)
          // Se ataca para esquerda (-x): vem pelo lado direito da bola (+x)
          const offsetX = atacaParaDireita ? -1.6 : 1.6;
          j.userData.destino = { x: bolaPos.x + offsetX, z: bolaPos.z };
        } else if (i < dests.length) {
          j.userData.destino = { x: dests[i][0], z: dests[i][1] };
        }
      });
    };

    applyTime(jogadoresRef.current.filter(j => j.userData.timeId === s.meuTime    && !j.userData.ehGoleiro), destJog, true);
    applyTime(jogadoresRef.current.filter(j => j.userData.timeId === s.adversario && !j.userData.ehGoleiro), destIA,  false);
  }, []);

  // ─── Avançar turno ───────────────────────────────────────────
  const avancarTurno = useCallback(() => {
    const s = gs.current;
    s.turno = s.turno === s.meuTime ? s.adversario : s.meuTime;
    s.fase = 'IDLE';
    s.botaoSel = null; s.botaoMovendo = null;
    s.botaoVelVec.set(0, 0, 0);
    removerSeta();
    if (s.turno === s.adversario) {
      s.fase = 'IA_PENSANDO';
      setTimeout(() => executarJogadaIARef.current(), 800 + Math.random() * 600);
    }
  }, [removerSeta]);

  // ─── IA ──────────────────────────────────────────────────────
  const executarJogadaIA = useCallback(() => {
    const s = gs.current;
    if (!s.jogoAtivo || !s.gameActive) return;

    const bola = bolaRef.current!;
    const jogIA = jogadoresRef.current.filter(j => j.userData.timeId === s.adversario && !j.userData.ehGoleiro);

    let melhor: THREE.Group | null = null, menorD = Infinity;
    for (const j of jogIA) {
      const d = j.position.distanceTo(bola.position);
      if (d < menorD) { menorD = d; melhor = j; }
    }
    if (!melhor) { avancarTurno(); return; }

    const GOL_ALVO_X = -15;
    const erroZ = (Math.random() - 0.5) * (menorD > 4 ? 1.5 : 3.0);
    let dir: THREE.Vector3;

    if (menorD > 3.5) {
      dir = new THREE.Vector3().subVectors(bola.position, melhor.position).normalize();
      dir.y = 0;
    } else {
      const golAlvo   = new THREE.Vector3(GOL_ALVO_X, 0, erroZ);
      const dirBG     = new THREE.Vector3().subVectors(golAlvo, bola.position).normalize();
      dirBG.y = 0;
      const abordagem = bola.position.clone().sub(dirBG.clone().multiplyScalar(2.2));
      if (melhor.position.distanceTo(abordagem) < 1.8) {
        dir = dirBG.clone();
      } else {
        dir = new THREE.Vector3().subVectors(abordagem, melhor.position).normalize();
        dir.y = 0;
      }
    }
    if (dir.length() < 0.01) dir.set(-1, 0, 0);

    const velMult = menorD < 3.5 ? 1.0 + Math.random() * 0.15 : 0.85 + Math.random() * 0.2;
    s.botaoMovendo = melhor;
    s.botaoVelVec.copy(dir).multiplyScalar(BOTAO_VEL * velMult);
    s.fase = 'DESLIZANDO';
    somChute();
  }, [avancarTurno, somChute]);

  useEffect(() => {
    executarJogadaIARef.current = executarJogadaIA;
  }, [executarJogadaIA]);

  // ─── Inicializar cena Three.js ───────────────────────────────
  const initThree = useCallback(() => {
    if (!mountRef.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1f3a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sol = new THREE.DirectionalLight(0xfff8ee, 1.0);
    sol.position.set(0, 30, 0); sol.castShadow = true; scene.add(sol);
    [[-18,20,-13],[18,20,-13],[-18,20,13],[18,20,13]].forEach(([x,y,z]) => {
      const sp = new THREE.SpotLight(0xfff5cc, 0.55, 80, Math.PI/5, 0.3);
      sp.position.set(x, y, z); sp.target.position.set(0,0,0);
      scene.add(sp); scene.add(sp.target);
    });

    const loader = new THREE.TextureLoader();
    texRef.current.cruzeiro = loader.load('/cruzeiro.png');
    texRef.current.atletico = loader.load('/atletico.png');

    // Campo
    const campoTex = loader.load('/campo.png');
    campoTex.wrapS = campoTex.wrapT = THREE.ClampToEdgeWrapping;
    const campo = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 20),
      new THREE.MeshStandardMaterial({ map: campoTex, roughness: 0.85 })
    );
    campo.rotation.x = -Math.PI/2; campo.receiveShadow = true; scene.add(campo);

    // Grama extra
    const grama = new THREE.Mesh(
      new THREE.PlaneGeometry(55, 42),
      new THREE.MeshStandardMaterial({ color: 0x14521a, roughness: 0.9 })
    );
    grama.rotation.x = -Math.PI/2; grama.position.y = -0.01; scene.add(grama);

    // Arquibancadas
    const arqTex = loader.load('/arquibancada.png');
    const arqMat = () => new THREE.MeshStandardMaterial({ map: arqTex, roughness: 0.9 });
    const arqN = new THREE.Mesh(new THREE.PlaneGeometry(55, 12), arqMat());
    arqN.rotation.x = Math.PI/8; arqN.position.set(0, 5, -20); scene.add(arqN);
    const arqS = new THREE.Mesh(new THREE.PlaneGeometry(55, 12), arqMat());
    arqS.rotation.x = -Math.PI/8; arqS.position.set(0, 5, 20); scene.add(arqS);
    const arqW = new THREE.Mesh(new THREE.PlaneGeometry(32, 12), arqMat());
    arqW.rotation.y = Math.PI/2; arqW.rotation.x = Math.PI/10; arqW.position.set(-24, 5, 0); scene.add(arqW);
    const arqE = new THREE.Mesh(new THREE.PlaneGeometry(32, 12), arqMat());
    arqE.rotation.y = -Math.PI/2; arqE.rotation.x = Math.PI/10; arqE.position.set(24, 5, 0); scene.add(arqE);

    // Mastros de luz
    const mastroMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7 });
    const lampMat   = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 1 });
    [[-20,-15],[20,-15],[-20,15],[20,15]].forEach(([x,z]) => {
      const mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 24, 8), mastroMat);
      mastro.position.set(x, 12, z); scene.add(mastro);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 1.1), lampMat);
      lamp.position.set(x, 24.5, z); scene.add(lamp);
    });

    // Traves
    const traveMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.65, roughness: 0.25 });
    const criarTrave = (px: number) => {
      const g = new THREE.Group();
      const lG = 6, aG = 2.5;
      const cyl = new THREE.CylinderGeometry(0.12, 0.12, aG, 8);
      const p1 = new THREE.Mesh(cyl, traveMat); p1.position.set(0, aG/2, -lG/2); g.add(p1);
      const p2 = new THREE.Mesh(cyl, traveMat); p2.position.set(0, aG/2,  lG/2); g.add(p2);
      const tv = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, lG, 8), traveMat);
      tv.rotation.x = Math.PI/2; tv.position.set(0, aG, 0); g.add(tv);
      const rm = new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
      const rf = new THREE.Mesh(new THREE.PlaneGeometry(lG, aG), rm);
      rf.rotation.y = Math.PI/2; rf.position.set(1.2*Math.sign(px), aG/2, 0); g.add(rf);
      [-1,1].forEach(s => {
        const rl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, aG), rm);
        rl.position.set(0.6*Math.sign(px), aG/2, s*lG/2); g.add(rl);
      });
      g.position.x = px; scene.add(g);
    };
    criarTrave(-15); criarTrave(15);

    // Bola
    const bola = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    );
    bola.position.set(0, 0.5, 0); bola.castShadow = true; scene.add(bola);
    bolaRef.current = bola;

    // Linhas do campo
    const linMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.8, transparent: true });
    const addLinha = (x1: number, z1: number, x2: number, z2: number, w = 0.12) => {
      const dx = x2-x1, dz = z2-z1;
      const len = Math.sqrt(dx*dx + dz*dz);
      const ang = Math.atan2(dx, dz);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), linMat);
      m.rotation.x = -Math.PI/2; m.rotation.z = -ang;
      m.position.set((x1+x2)/2, 0.015, (z1+z2)/2);
      scene.add(m);
    };
    addLinha(-15,-10, 15,-10); addLinha(-15, 10, 15, 10);
    addLinha(-15,-10,-15, 10); addLinha( 15,-10, 15, 10);
    addLinha(0, -10, 0, 10);
    const N=40, R=3;
    for (let i=0; i<N; i++) {
      const a1=(i/N)*Math.PI*2, a2=((i+1)/N)*Math.PI*2;
      addLinha(Math.sin(a1)*R, Math.cos(a1)*R, Math.sin(a2)*R, Math.cos(a2)*R, 0.1);
    }
    const pt = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), linMat);
    pt.rotation.x = -Math.PI/2; pt.position.set(0, 0.016, 0); scene.add(pt);
    addLinha(-15,-5.5,-11,-5.5); addLinha(-15,5.5,-11,5.5); addLinha(-11,-5.5,-11,5.5);
    addLinha( 15,-5.5, 11,-5.5); addLinha( 15,5.5, 11,5.5); addLinha( 11,-5.5, 11,5.5);
    addLinha(-15,-3.1,-13,-3.1); addLinha(-15,3.1,-13,3.1); addLinha(-13,-3.1,-13,3.1);
    addLinha( 15,-3.1, 13,-3.1); addLinha( 15,3.1, 13,3.1); addLinha( 13,-3.1, 13,3.1);
  }, []);

  // ─── Loop principal ──────────────────────────────────────────
  const startLoop = useCallback(() => {
    const loop = (now: number) => {
      frameRef.current = requestAnimationFrame(loop);
      const previous = lastFrameRef.current ?? now;
      const dt = Math.min(2, Math.max(0.5, (now - previous) / 16.6667));
      lastFrameRef.current = now;
      atualizarCamera();
      const scene = sceneRef.current!;
      const s = gs.current;

      if (!s.jogoAtivo) { rendererRef.current!.render(scene, cameraRef.current!); return; }

      const bola = bolaRef.current!;
      const bv   = bolaVel.current;

      // ── 1. Botão principal deslizando ───────────────────────
      if (s.fase === 'DESLIZANDO' && s.botaoMovendo) {
        const bot = s.botaoMovendo;
        const vel = s.botaoVelVec;

        bot.position.x += vel.x * dt;
        bot.position.z += vel.z * dt;
        const spd = vel.length();
        bot.position.y = (bot.userData.ehGoleiro ? 0.29 : 0.24) + Math.sin(spd*12)*0.04;

        // Colisão botão-bola: separa os objetos antes de aplicar o impulso.
        const rBot = bot.userData.ehGoleiro ? 1.0 : 0.85;
        const normalBola = new THREE.Vector3(
          bola.position.x - bot.position.x, 0, bola.position.z - bot.position.z,
        );
        const db = normalBola.length();
        if (db < rBot + 0.5) {
          if (db < 0.001) normalBola.set(1, 0, 0);
          else normalBola.normalize();
          const sobreposicao = rBot + 0.5 - db;
          bola.position.x += normalBola.x * sobreposicao;
          bola.position.z += normalBola.z * sobreposicao;
          const aproximacao = vel.x * normalBola.x + vel.z * normalBola.z;
          if (aproximacao > 0) {
            const impulso = Math.max(spd * 2.0, 0.08);
            bv.set(normalBola.x * impulso, 0, normalBola.z * impulso);
            somChute();
          }
        }

        // Colisão com outros botões
        for (const outro of jogadoresRef.current) {
          if (outro === bot) continue;
          const rO = outro.userData.ehGoleiro ? 1.0 : 0.85;
          const normal = new THREE.Vector3(
            outro.position.x - bot.position.x, 0, outro.position.z - bot.position.z,
          );
          const d = normal.length();
          if (d < rBot + rO) {
            if (d < 0.001) normal.set(1, 0, 0);
            else normal.normalize();
            const sep = (rBot + rO - d) * 0.5;
            outro.position.x += normal.x * sep;
            outro.position.z += normal.z * sep;
            bot.position.x -= normal.x * sep;
            bot.position.z -= normal.z * sep;
            const impulso = spd * 0.7;
            outro.userData.vel.set(normal.x * impulso, 0, normal.z * impulso);
            vel.x -= normal.x * impulso * 0.35;
            vel.z -= normal.z * impulso * 0.35;
          }
        }

        vel.multiplyScalar(Math.pow(ATRITO, dt));
        if (bot.position.x >  14.2) { bot.position.x =  14.2; vel.x *= -0.5; }
        if (bot.position.x < -14.2) { bot.position.x = -14.2; vel.x *= -0.5; }
        if (bot.position.z >  9.2)  { bot.position.z =  9.2;  vel.z *= -0.5; }
        if (bot.position.z < -9.2)  { bot.position.z = -9.2;  vel.z *= -0.5; }

        if (vel.length() < MIN_VEL) {
          vel.set(0,0,0);
          bot.position.y = bot.userData.ehGoleiro ? 0.29 : 0.24;
          s.botaoMovendo = null;
        }
      }

      // ── 2. Outros botões empurrados ──────────────────────────
      for (const j of jogadoresRef.current) {
        if (j === s.botaoMovendo) continue;
        const v = j.userData.vel as THREE.Vector3;
        if (v.length() < MIN_VEL) { v.set(0,0,0); continue; }
        j.position.x += v.x * dt; j.position.z += v.z * dt;
        v.multiplyScalar(Math.pow(ATRITO, dt));
        if (j.position.x >  14.2) { j.position.x =  14.2; v.x *= -0.5; }
        if (j.position.x < -14.2) { j.position.x = -14.2; v.x *= -0.5; }
        if (j.position.z >  9.2)  { j.position.z =  9.2;  v.z *= -0.5; }
        if (j.position.z < -9.2)  { j.position.z = -9.2;  v.z *= -0.5; }
      }

      // ── 3. Bola ──────────────────────────────────────────────
      bola.position.x += bv.x * dt; bola.position.z += bv.z * dt;
      bola.rotation.x += bv.z * 0.6 * dt; bola.rotation.z -= bv.x * 0.6 * dt;
      bv.multiplyScalar(Math.pow(BOLA_ATRITO, dt));
      if (bv.length() < MIN_VEL*0.4) bv.set(0,0,0);
      if (bola.position.z >  9.5) { bola.position.z =  9.5; bv.z *= -0.75; }
      if (bola.position.z < -9.5) { bola.position.z = -9.5; bv.z *= -0.75; }
      if (bola.position.x >  14.5 && Math.abs(bola.position.z) >= 3.1) { bola.position.x =  14.5; bv.x *= -0.65; }
      if (bola.position.x < -14.5 && Math.abs(bola.position.z) >= 3.1) { bola.position.x = -14.5; bv.x *= -0.65; }
      bola.position.y = 0.5;

      // ── 4. Goleiros ──────────────────────────────────────────
      for (const gol of goleirosRef.current) {
        const gx = gol.position.x;
        if (bv.length() > 0.02) {
          const dg  = Math.abs(bola.position.x - gx);
          const indo = (gx < 0 && bv.x < -0.02) || (gx > 0 && bv.x > 0.02);
          const mv  = (indo && dg < 12) ? 0.18 : (dg < 8 ? 0.08 : 0.02);
          const tf  = dg / (Math.abs(bv.x) + 0.01);
          const alvo = Math.max(-2.9, Math.min(2.9, bola.position.z + bv.z * Math.min(tf, 25)));
          gol.position.z += (alvo - gol.position.z) * mv;
        }
        const db = gol.position.distanceTo(bola.position);
        if (db < 1.6) {
          const dir = new THREE.Vector3().subVectors(bola.position, gol.position).normalize();
          dir.y = 0;
          const saidaX = gx < 0 ? 1 : -1;
          const saida  = new THREE.Vector3(saidaX, 0, (Math.random()-0.5)*0.8).normalize();
          const cd     = dir.clone().add(saida).normalize();
          bv.copy(cd.multiplyScalar(0.22 + bv.length()*0.5));
        }
      }

      // ── 5. Fim de jogada ─────────────────────────────────────
      if (s.fase === 'DESLIZANDO' && !s.botaoMovendo && !s.jogadaEncerrada) {
        const parado = bv.length() < MIN_VEL &&
          jogadoresRef.current.every(j => (j.userData.vel as THREE.Vector3).length() < MIN_VEL);
        if (parado) {
          s.jogadaEncerrada = true;
          // As posições obtidas na jogada permanecem no campo.
          // Só trocamos o turno quando toda a física terminou.
          s.jogadaEncerrada = false;
          avancarTurno();
        }
      }

      // ── 6. Seta de mira ──────────────────────────────────────
      if (setaRef.current && s.botaoSel) {
        setaRef.current.position.copy(s.botaoSel.position);
        setaRef.current.position.y = 0.7;
      }

      // ── 7. Gol ───────────────────────────────────────────────
      verificarGol(addGol);

      // ── 8. Confetes ──────────────────────────────────────────
      tickConfetes();

      rendererRef.current!.render(scene, cameraRef.current!);
    };
    frameRef.current = requestAnimationFrame(loop);
  }, [atualizarCamera, verificarGol, addGol, avancarTurno, tickConfetes, somChute]);

  // ─── Iniciar jogo ────────────────────────────────────────────
  const iniciarJogo = useCallback((time: TimeId) => {
    const s = gs.current;
    s.meuTime    = time;
    s.adversario = time === 'cruzeiro' ? 'atletico' : 'cruzeiro';
    s.jogoAtivo  = true;
    s.gameActive = true;
    s.turno      = time;
    s.fase       = 'IDLE';
    s.botaoSel   = null; s.botaoMovendo = null;
    criarTimes();
    bolaRef.current!.position.set(0, 0.5, 0);
    bolaVel.current.set(0, 0, 0);
    setGameState('PLAYING');
  }, [criarTimes, setGameState]);

  // ─── Montar Three.js ─────────────────────────────────────────
  useEffect(() => {
    initThree();
    startLoop();
    const mount = mountRef.current;
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      gs.current.camDist = Math.max(14, Math.min(68, gs.current.camDist + e.deltaY*0.04));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('wheel', onWheel);
      rendererRef.current?.dispose();
      if (mount && rendererRef.current && mount.contains(rendererRef.current.domElement))
        mount.removeChild(rendererRef.current.domElement);
    };
  }, [initThree, startLoop]);

  // ─── Eventos de ponteiro ─────────────────────────────────────
  useEffect(() => {
    const el = rendererRef.current?.domElement;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        gs.current.camRotating = true;
        gs.current.rotStart = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId); return;
      }
      if (e.button !== 0) return;
      const s = gs.current;
      if (!s.jogoAtivo || !s.gameActive) return;

      if (s.fase === 'IDLE') {
        if (s.turno !== s.meuTime) return;
        mouse2d.current.x =  (e.clientX / window.innerWidth)  * 2 - 1;
        mouse2d.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.current.setFromCamera(mouse2d.current, cameraRef.current!);
        const hits = raycaster.current.intersectObjects(jogadoresRef.current, true);
        let sel: THREE.Group | null = null;
        if (hits.length > 0) {
          let obj: THREE.Object3D = hits[0].object;
          while (obj.parent && !jogadoresRef.current.includes(obj as THREE.Group)) obj = obj.parent;
          const g = obj as THREE.Group;
          if (jogadoresRef.current.includes(g) && g.userData.timeId === s.meuTime && !g.userData.ehGoleiro)
            sel = g;
        }
        if (sel) {
          s.botaoSel = sel; s.fase = 'MIRA';
          somSelecao();
          jogadoresRef.current.forEach(j => {
            if (j.children[0]) (j.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.emissive?.setHex(0x000000);
          });
          if (sel.children[0]) (sel.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.emissive?.setHex(0x333300);
          const dir = new THREE.Vector3().subVectors(bolaRef.current!.position, sel.position).normalize();
          dir.y = 0; if (dir.length() < 0.01) dir.set(1,0,0);
          s.dirSeta.copy(dir); atualizarSeta(dir);
        }
        return;
      }

      if (s.fase === 'MIRA' && s.botaoSel) {
        const dir = s.dirSeta.clone(); dir.y = 0;
        if (dir.length() < 0.01) dir.set(1,0,0);
        s.botaoMovendo = s.botaoSel;
        s.botaoVelVec.copy(dir).multiplyScalar(BOTAO_VEL * s.potencia);
        s.botaoSel = null; s.fase = 'DESLIZANDO'; s.potencia = 1;
        removerSeta(); somConfirma();
        jogadoresRef.current.forEach(j => {
          if (j.children[0]) (j.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.emissive?.setHex(0x000000);
        });
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = gs.current;
      if (s.camRotating) {
        s.camH -= (e.clientX - s.rotStart.x) * 0.008;
        s.camV  = Math.max(0.15, Math.min(1.5, s.camV + (e.clientY - s.rotStart.y) * 0.005));
        s.rotStart = { x: e.clientX, y: e.clientY }; return;
      }
      if (s.fase === 'MIRA' && s.botaoSel) {
        const pt = mouseToPlane(e.clientX, e.clientY);
        if (pt) {
          const vetorMira = new THREE.Vector3().subVectors(pt, s.botaoSel.position);
          vetorMira.y = 0;
          const distancia = vetorMira.length();
          const d = vetorMira.normalize();
          d.y = 0;
          if (d.length() > 0.01) {
            s.dirSeta.copy(d);
            s.potencia = Math.min(1.8, Math.max(0.35, distancia / 5));
            atualizarSeta(d);
          }
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.button === 2) {
        gs.current.camRotating = false;
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };

    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [atualizarSeta, removerSeta, mouseToPlane, somSelecao, somConfirma, somChute]);

  // ─── Expor para HUD ──────────────────────────────────────────
  useEffect(() => {
    (window as unknown as { _iniciarJogoBtn: (t: TimeId) => void })._iniciarJogoBtn = iniciarJogo;
  }, [iniciarJogo]);

  useEffect(() => {
    const id = setInterval(() => {
      (window as unknown as { _turnoAtual?: string; _faseJogada?: string })._turnoAtual = gs.current.turno;
      (window as unknown as { _turnoAtual?: string; _faseJogada?: string })._faseJogada = gs.current.fase;
    }, 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div ref={mountRef} className="absolute inset-0"
      style={{ width: '100vw', height: '100vh', touchAction: 'none' }} />
  );
};

export default GameCanvas;
