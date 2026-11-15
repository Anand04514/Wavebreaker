import Phaser from 'phaser';
import { VIEWPORT, COLORS, FONT_FAMILY, FONT_MONO } from '../config';
import { audio } from '../systems/AudioManager';
import type { RunSummary } from './GameScene';

const EMPTY_SUMMARY: RunSummary = { score: 0, wave: 0, kills: 0, best: 0, newBest: false };

export class GameOverScene extends Phaser.Scene {
  private summary: RunSummary = { ...EMPTY_SUMMARY };

  constructor() {
    super('GameOverScene');
  }

  init(data: Partial<RunSummary> | undefined): void {
    this.summary = { ...EMPTY_SUMMARY, ...(data ?? {}) };
  }

  create(): void {
    const { width, height } = VIEWPORT;
    const { score, wave, kills, best, newBest } = this.summary;

    this.add.tileSprite(0, 0, width, height, 'floor').setOrigin(0).setAlpha(0.4);
    this.add.rectangle(0, 0, width, height, 0x04070a, 0.78).setOrigin(0);

    const glow = this.add.graphics();
    for (let i = 5; i >= 1; i -= 1) {
      glow.fillStyle(newBest ? 0x2a6b3f : 0x5c1a2a, 0.045);
      glow.fillCircle(width / 2, height * 0.4, i * 120);
    }

    this.add
      .text(width / 2, 132, newBest ? 'NEW RECORD' : 'RUN OVER', {
        fontFamily: FONT_FAMILY,
        fontSize: '58px',
        fontStyle: 'bold',
        color: newBest ? '#c9ffdd' : '#ffe6ec',
      })
      .setOrigin(0.5)
      .setLetterSpacing(7)
      .setShadow(0, 0, newBest ? '#4ade80' : '#ff5e7a', 26, true, true);

    this.add
      .text(width / 2, 190, newBest ? 'YOU OUTLASTED YOUR BEST' : 'THE SWARM GOT YOU', {
        fontFamily: FONT_MONO,
        fontSize: '14px',
        color: COLORS.textDim,
      })
      .setOrigin(0.5)
      .setLetterSpacing(4);

    // Score counts up so the result lands with a little weight.
    const scoreLabel = this.add
      .text(width / 2, 262, 'SCORE', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: '#6b8497',
      })
      .setOrigin(0.5)
      .setLetterSpacing(4);

    const scoreValue = this.add
      .text(width / 2, 288, '0', {
        fontFamily: FONT_MONO,
        fontSize: '64px',
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(0.5, 0)
      .setShadow(0, 0, '#38d9ff', 22, true, true);

    const counter = { value: 0 };
    this.tweens.add({
      targets: counter,
      value: score,
      duration: 750,
      ease: 'Cubic.easeOut',
      onUpdate: () => scoreValue.setText(Math.round(counter.value).toLocaleString()),
      onComplete: () => scoreValue.setText(score.toLocaleString()),
    });

    scoreLabel.setAlpha(0.9);

    this.statRow(width / 2 - 220, 400, 'WAVE REACHED', `${Math.max(1, wave)}`);
    this.statRow(width / 2, 400, 'KILLS', `${kills}`);
    this.statRow(width / 2 + 220, 400, 'BEST', best.toLocaleString());

    if (newBest && score > 0) {
      const badge = this.add.container(width / 2, 348);
      const bg = this.add.graphics();
      bg.fillStyle(0x4ade80, 0.16);
      bg.fillRoundedRect(-92, -16, 184, 32, 16);
      bg.lineStyle(1, 0x4ade80, 0.85);
      bg.strokeRoundedRect(-92, -16, 184, 32, 16);
      const text = this.add
        .text(0, 0, 'NEW HIGH SCORE', {
          fontFamily: FONT_MONO,
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#c9ffdd',
        })
        .setOrigin(0.5)
        .setLetterSpacing(2);
      badge.add([bg, text]);
      this.tweens.add({
        targets: badge,
        scale: { from: 0.85, to: 1 },
        duration: 420,
        delay: 400,
        ease: 'Back.easeOut',
      });
    }

    this.makeButton(width / 2, 512, 'PLAY AGAIN', 0x6ee7ff, () => this.restart());
    this.makeButton(width / 2, 574, 'MAIN MENU', 0xff7d95, () => this.toMenu());

    this.add
      .text(width / 2, 634, 'ENTER or R to retry   ·   ESC for menu', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: '#5f798b',
      })
      .setOrigin(0.5);

    this.input.keyboard?.on('keydown-ENTER', this.restart, this);
    this.input.keyboard?.on('keydown-R', this.restart, this);
    this.input.keyboard?.on('keydown-ESC', this.toMenu, this);
    // The audio keys work on every screen that is not a run, so they are not re-learned here.
    this.input.keyboard?.on('keydown-M', this.toggleMusic, this);
    this.input.keyboard?.on('keydown-N', this.toggleSound, this);
    this.input.once('pointerdown', () => audio.unlock());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.restart, this);
      this.input.keyboard?.off('keydown-R', this.restart, this);
      this.input.keyboard?.off('keydown-ESC', this.toMenu, this);
      this.input.keyboard?.off('keydown-M', this.toggleMusic, this);
      this.input.keyboard?.off('keydown-N', this.toggleSound, this);
    });

    this.cameras.main.fadeIn(300, 0, 0, 0);
  }

  /** M: the music bus. There is no switch on this screen to repaint, so the state is all it changes. */
  private toggleMusic(): void {
    audio.toggleMusicBus();
  }

  /** N: sound effects, the same bus the HUD switch and the pause panel drive. */
  private toggleSound(): void {
    audio.toggleSoundBus();
  }

  private statRow(x: number, y: number, label: string, value: string): void {
    this.add
      .text(x, y, label, {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#6b8497',
      })
      .setOrigin(0.5)
      .setLetterSpacing(3);
    this.add
      .text(x, y + 26, value, {
        fontFamily: FONT_MONO,
        fontSize: '24px',
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(0.5);
  }

  private makeButton(x: number, y: number, text: string, tint: number, onClick: () => void): void {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const label = this.add
      .text(0, 0, text, {
        fontFamily: FONT_MONO,
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#dffaff',
      })
      .setOrigin(0.5)
      .setLetterSpacing(2);

    const draw = (hover: boolean): void => {
      bg.clear();
      bg.fillStyle(tint, hover ? 0.24 : 0.12);
      bg.fillRoundedRect(-140, -22, 280, 44, 12);
      bg.lineStyle(1, tint, hover ? 1 : 0.65);
      bg.strokeRoundedRect(-140, -22, 280, 44, 12);
    };
    draw(false);

    container.add([bg, label]);
    container.setSize(280, 44);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerover', () => {
      draw(true);
      label.setColor('#ffffff');
    });
    container.on('pointerout', () => {
      draw(false);
      label.setColor('#dffaff');
    });
    container.on('pointerup', onClick);
  }

  private restart(): void {
    audio.play('click');
    this.scene.start('GameScene');
  }

  private toMenu(): void {
    audio.play('click');
    this.scene.start('MenuScene');
  }
}
