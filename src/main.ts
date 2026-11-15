import Phaser from 'phaser';
import { VIEWPORT } from './config';
import { BootScene } from './scenes/BootScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';
import { MenuScene } from './scenes/MenuScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  backgroundColor: '#070b10',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  fps: { target: 60, forceSetTimeOut: false },
  scene: [BootScene, MenuScene, GameScene, HudScene, GameOverScene],
};

const game = new Phaser.Game(config);

// Dev-only handle so a playtest can read state from the browser console.
if (import.meta.env.DEV) {
  (window as unknown as { game: Phaser.Game }).game = game;
}
