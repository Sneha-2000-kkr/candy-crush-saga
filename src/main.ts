import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { H, SagaMapScene, W } from './scenes/SagaMapScene';
import { sound } from './audio/SoundSynth';
import { findValidMoves } from './core/MoveValidator';
import { save } from './storage/SaveManager';

sound.setMuted(save.muted);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#2b1055',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 1 },
  render: { antialias: true, roundPixels: false },
  scene: [BootScene, SagaMapScene, GameScene],
});

// Debug / E2E hooks (read-only helpers; no gameplay side effects)
(window as unknown as { __candy: unknown }).__candy = {
  game,
  save,
  validMoves: () => {
    const scene = game.scene.getScene('GameScene') as GameScene;
    return findValidMoves(scene.engine.board);
  },
};

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
