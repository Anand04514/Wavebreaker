import Phaser from 'phaser';
import {
  ARENA,
  AUDIO,
  BOMB,
  BOSS,
  BUDDY,
  COLORS,
  DASH,
  ENEMY_SPECS,
  FONT_FAMILY,
  FONT_MONO,
  HEALER,
  MAPS,
  PICKUPS,
  VIEWPORT,
  type GameMap,
} from '../config';
import { audio } from '../systems/AudioManager';
import { getMap } from '../systems/MapLogic';
import { renderKnowYourEnemy } from './KnowYourEnemyPanel';
import { loadHighScore, loadMapId, saveMapId } from '../systems/Storage';

export class MenuScene extends Phaser.Scene {
  private buttonBg!: Phaser.GameObjects.Graphics;
  private soundButton?: Phaser.GameObjects.Container;
  private musicButton?: Phaser.GameObjects.Container;
  private overlay?: Phaser.GameObjects.Container;

  constructor() {
    super('MenuScene');
  }

  create(): void {
    const { width, height } = VIEWPORT;

    // Scene instances are reused when returning from a run.
    this.overlay = undefined;
    this.optionsDraws = [];

    this.add.tileSprite(0, 0, width, height, 'floor').setOrigin(0).setAlpha(0.55);

    // Soft light wells so the background is not flat.
    const glow = this.add.graphics();
    for (let i = 6; i >= 1; i -= 1) {
      glow.fillStyle(0x1f5f7a, 0.05);
      glow.fillCircle(width / 2, height * 0.42, i * 100);
    }
    this.add.rectangle(width / 2, height / 2, width, height, 0x05090d, 0.55);

    this.createFloatingDecor();

    const title = this.add
      .text(width / 2, 168, 'WAVEBREAKER', {
        fontFamily: FONT_FAMILY,
        fontSize: '76px',
        fontStyle: 'bold',
        color: '#eafcff',
        stroke: '#0a2531',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#38d9ff', 28, true, true);
    title.setLetterSpacing(8);

    const subtitle = this.add
      .text(width / 2, 236, 'SURVIVE  THE  SWARM', {
        fontFamily: FONT_MONO,
        fontSize: '18px',
        color: COLORS.textDim,
      })
      .setOrigin(0.5);
    subtitle.setLetterSpacing(6);

    this.createPlayButton(width / 2, 380);
    this.createMenuButton(width / 2 - 200, 464, 'OPTIONS', () => this.openOptions());
    this.createMenuButton(width / 2, 464, 'MAPS', () => this.openMaps());
    this.createMenuButton(width / 2 + 200, 464, 'HELP', () => this.openHelp());

    this.add
      .text(width / 2, 516, 'or press ENTER', {
        fontFamily: FONT_MONO,
        fontSize: '13px',
        color: '#5f798b',
      })
      .setOrigin(0.5);

    const best = loadHighScore();
    this.add
      .text(44, height - 54, best > 0 ? `BEST  ${best.toLocaleString()}` : 'NO RECORD YET', {
        fontFamily: FONT_MONO,
        fontSize: '16px',
        color: best > 0 ? COLORS.multiplier : '#5f798b',
      })
      .setOrigin(0, 0.5);

    this.add
      .text(width / 2, height - 30, 'Placeholder art · Synthesised audio · v1.0', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: '#4d6373',
      })
      .setOrigin(0.5);

    // Two switches, not one: SOUND covers the effects, MUSIC covers the score.
    this.createAudioButton(width - 234, 52, 'sound');
    this.createAudioButton(width - 78, 52, 'music');
    this.refreshAudioLabels();

    this.input.keyboard?.on('keydown-ENTER', this.startGame, this);
    this.input.keyboard?.on('keydown-SPACE', this.startGame, this);
    // Starts once a gesture has unlocked audio; harmless to ask again on every visit to the menu.
    audio.playMusic('menu');
    this.input.keyboard?.on('keydown-ESC', this.closeOverlay, this);
    // The same M and N keys as a run, so the switches in the corner answer to the keyboard here too.
    this.input.keyboard?.on('keydown-M', this.toggleMusicKey, this);
    this.input.keyboard?.on('keydown-N', this.toggleSoundKey, this);
    this.input.once('pointerdown', () => audio.unlock());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.startGame, this);
      this.input.keyboard?.off('keydown-SPACE', this.startGame, this);
      this.input.keyboard?.off('keydown-ESC', this.closeOverlay, this);
      this.input.keyboard?.off('keydown-M', this.toggleMusicKey, this);
      this.input.keyboard?.off('keydown-N', this.toggleSoundKey, this);
    });

    this.cameras.main.fadeIn(320, 0, 0, 0);
  }

  private createPlayButton(x: number, y: number): void {
    const container = this.add.container(x, y).setDepth(5);
    this.buttonBg = this.add.graphics();
    const label = this.add
      .text(0, 0, 'PLAY', {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#dffaff',
      })
      .setOrigin(0.5);
    label.setLetterSpacing(4);
    container.add([this.buttonBg, label]);
    container.setSize(280, 68);
    container.setInteractive({ useHandCursor: true });

    const draw = (hover: boolean): void => {
      this.buttonBg.clear();
      this.buttonBg.fillStyle(0x6ee7ff, hover ? 0.16 : 0.07);
      this.buttonBg.fillRoundedRect(-140, -34, 280, 68, 18);
      this.buttonBg.lineStyle(2, 0x6ee7ff, hover ? 1 : 0.6);
      this.buttonBg.strokeRoundedRect(-139, -33, 278, 66, 18);
      this.buttonBg.fillStyle(0x103543, hover ? 0.98 : 0.9);
      this.buttonBg.fillRoundedRect(-134, -28, 268, 56, 14);
      label.setColor(hover ? '#ffffff' : '#dffaff');
    };
    draw(false);

    container.on('pointerover', () => {
      draw(true);
      this.tweens.add({ targets: container, scale: 1.04, duration: 120, ease: 'Quad.easeOut' });
    });
    container.on('pointerout', () => {
      draw(false);
      this.tweens.add({ targets: container, scale: 1, duration: 120, ease: 'Quad.easeOut' });
    });
    container.on('pointerup', this.startGame, this);
  }

  /** One labelled toggle in the menu corner: 'sound' for the effects, 'music' for the score. */
  private createAudioButton(x: number, y: number, kind: 'sound' | 'music'): void {
    const container = this.add.container(x, y).setDepth(6);
    const bg = this.add.graphics();
    const lamp = this.add.graphics();
    const label = this.add
      .text(12, 0, '', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#9fe9ff',
      })
      .setOrigin(0.5);

    // Lit lamp plus the word ON/OFF, so the state reads at a glance instead of by tint alone.
    const draw = (): void => {
      const on = kind === 'sound' ? !audio.isMuted : audio.isMusicEnabled;
      label.setText(`${kind === 'sound' ? 'SOUND' : 'MUSIC'}  ${on ? 'ON' : 'OFF'}`);
      label.setColor(on ? '#9fe9ff' : '#7d95a6');

      bg.clear();
      bg.fillStyle(on ? 0x6ee7ff : 0x0b131b, on ? 0.16 : 0.9);
      bg.fillRoundedRect(-75, -19, 150, 38, 10);
      bg.lineStyle(on ? 2 : 1, on ? 0x6ee7ff : 0x2b4457, 1);
      bg.strokeRoundedRect(-75, -19, 150, 38, 10);

      lamp.clear();
      lamp.fillStyle(on ? 0x6ee7ff : 0x33475a, 1);
      lamp.fillCircle(-54, 0, 5);
    };

    if (kind === 'sound') this.soundButton = container;
    else this.musicButton = container;

    container.add([bg, lamp, label]);
    container.setSize(150, 38);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerup', () => {
      if (kind === 'sound') audio.toggleSoundBus();
      else audio.toggleMusicBus();
      this.refreshAudioLabels();
    });
    container.setData('draw', draw);
  }

  /** Both switches repaint from their own state, so turning one off leaves the other alone. */
  /** Every live repaint hook for the OPTIONS pills (empty while that panel is closed). */
  private optionsDraws: Array<() => void> = [];

  /** M: the music bus, the same switch as the corner button. */
  private toggleMusicKey(): void {
    audio.toggleMusicBus();
    this.refreshAudioLabels();
  }

  /** N: sound effects, the same switch as the corner button. */
  private toggleSoundKey(): void {
    audio.toggleSoundBus();
    this.refreshAudioLabels();
  }

  private refreshAudioLabels(): void {
    for (const button of [this.soundButton, this.musicButton]) {
      const draw = button?.getData('draw') as (() => void) | undefined;
      if (draw) draw();
    }
    // The OPTIONS panel's pills sit on the same audio state, so they repaint with the corner pair.
    for (const draw of this.optionsDraws) draw();
  }

  private createFloatingDecor(): void {
    const shapes: Array<[string, number, number, number]> = [
      ['enemy-chaser', 180, 520, 0.9],
      ['enemy-runner', 1100, 480, 1.2],
      ['enemy-tank', 1010, 170, 0.7],
      ['enemy-shooter', 300, 210, 0.8],
      ['enemy-chaser', 1180, 640, 1.1],
    ];

    shapes.forEach(([key, x, y, speed], index) => {
      const sprite = this.add.image(x, y, key).setAlpha(0.16).setScale(1.4);
      this.tweens.add({
        targets: sprite,
        y: y + 26,
        rotation: index % 2 === 0 ? 0.6 : -0.6,
        duration: 3800 + index * 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: index * 240,
      });
      this.tweens.add({
        targets: sprite,
        alpha: 0.07,
        duration: 2400 + speed * 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    });
  }

  private startGame(): void {
    if (this.overlay) return;
    audio.unlock();
    audio.play('click');
    this.scene.start('GameScene');
  }

  /* -------------------------------------------------------------- overlays */

  /** Secondary menu button used for OPTIONS and HELP. */
  private createMenuButton(x: number, y: number, label: string, onClick: () => void): void {
    const container = this.add.container(x, y).setDepth(5);
    const bg = this.add.graphics();
    const text = this.add
      .text(0, 0, label, {
        fontFamily: FONT_MONO,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#9fe9ff',
      })
      .setOrigin(0.5);
    text.setLetterSpacing(3);
    container.add([bg, text]);
    container.setSize(176, 44);
    container.setInteractive({ useHandCursor: true });

    const draw = (hover: boolean): void => {
      bg.clear();
      bg.fillStyle(0x6ee7ff, hover ? 0.14 : 0.05);
      bg.fillRoundedRect(-88, -22, 176, 44, 12);
      bg.lineStyle(1, 0x6ee7ff, hover ? 1 : 0.45);
      bg.strokeRoundedRect(-88, -22, 176, 44, 12);
      text.setColor(hover ? '#ffffff' : '#9fe9ff');
    };
    draw(false);

    container.on('pointerover', () => draw(true));
    container.on('pointerout', () => draw(false));
    container.on('pointerup', () => {
      audio.unlock();
      audio.play('click');
      onClick();
    });
  }

  /** Dims the menu and returns the container content should be added to. */
  private openOverlay(title: string, panelHeight: number, panelWidth = 700): Phaser.GameObjects.Container {
    this.closeOverlay();

    const { width, height } = VIEWPORT;
    const left = (width - panelWidth) / 2;
    const top = (height - panelHeight) / 2;

    const container = this.add.container(0, 0).setDepth(30);

    const dim = this.add.rectangle(0, 0, width, height, 0x04070a, 0.82).setOrigin(0);
    dim.setInteractive();
    dim.on('pointerup', () => this.closeOverlay());

    const panel = this.add.graphics();
    panel.fillStyle(0x0b131b, 0.98);
    panel.fillRoundedRect(left, top, panelWidth, panelHeight, 18);
    panel.lineStyle(1, 0x2b4457, 1);
    panel.strokeRoundedRect(left, top, panelWidth, panelHeight, 18);

    const heading = this.add
      .text(width / 2, top + 38, title, {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#dffaff',
      })
      .setOrigin(0.5);
    heading.setLetterSpacing(5);

    const close = this.add
      .text(width / 2, top + panelHeight - 32, 'CLOSE   ·   ESC', {
        fontFamily: FONT_MONO,
        fontSize: '13px',
        color: '#7d95a6',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#dffaff'));
    close.on('pointerout', () => close.setColor('#7d95a6'));
    close.on('pointerup', () => this.closeOverlay());

    container.add([dim, panel, heading, close]);
    this.overlay = container;
    return container;
  }

  private closeOverlay(): void {
    if (!this.overlay) return;
    this.overlay.destroy(true);
    this.overlay = undefined;
    // Their draw closures point at objects that no longer exist.
    this.optionsDraws = [];
  }

  private openOptions(): void {
    const panelHeight = 372;
    const container = this.openOverlay('OPTIONS', panelHeight);
    const { width, height } = VIEWPORT;
    const top = (height - panelHeight) / 2;
    const rowOne = top + 116;
    const rowTwo = top + 186;
    const rowThree = top + 256;
    const labelX = width / 2 - 250;

    const rowLabel = (y: number, text: string): void => {
      container.add(
        this.add.text(labelX, y, text, {
          fontFamily: FONT_MONO,
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#9fe9ff',
        }).setOrigin(0, 0.5),
      );
    };

    rowLabel(rowOne, 'SOUND');
    rowLabel(rowTwo, 'VOLUME');
    rowLabel(rowThree, 'MUSIC');

    /** Shared ON/OFF pill, used by the sound and music rows. */
    const toggleSwitch = (y: number, isOn: () => boolean, onToggle: () => void): void => {
      const bg = this.add.graphics();
      const label = this.add
        .text(width / 2 + 210, y, '', {
          fontFamily: FONT_MONO,
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#9fe9ff',
        })
        .setOrigin(0.5);
      const draw = (): void => {
        const on = isOn();
        label.setText(on ? 'ON' : 'OFF');
        label.setColor(on ? '#9fe9ff' : '#7d95a6');
        bg.clear();
        bg.fillStyle(on ? 0x6ee7ff : 0x24394a, on ? 0.14 : 0.4);
        bg.fillRoundedRect(width / 2 + 156, y - 19, 108, 38, 10);
        bg.lineStyle(1, on ? 0x6ee7ff : 0x2b4457, 1);
        bg.strokeRoundedRect(width / 2 + 156, y - 19, 108, 38, 10);
      };
      draw();
      this.optionsDraws.push(draw);
      const hit = this.add
        .rectangle(width / 2 + 210, y, 108, 38, 0x000000, 0.001)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => {
        onToggle();
        draw();
      });
      container.add([bg, label, hit]);
    };

    toggleSwitch(
      rowOne,
      () => !audio.isMuted,
      () => {
        audio.toggleSoundBus();
        this.refreshAudioLabels();
      },
    );

    toggleSwitch(
      rowThree,
      () => audio.isMusicEnabled,
      () => {
        audio.toggleMusicBus();
        this.refreshAudioLabels();
      },
    );

    // Volume down / up.
    const volumeLabel = this.add
      .text(width / 2 + 210, rowTwo, '', {
        fontFamily: FONT_MONO,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#dffaff',
      })
      .setOrigin(0.5);

    const drawVolume = (): void => {
      volumeLabel.setText(`${Math.round(audio.volume * 100)}%`);
    };
    drawVolume();

    const volumeButton = (x: number, glyph: string, delta: number): void => {
      const bg = this.add.graphics();
      const draw = (hover: boolean): void => {
        bg.clear();
        bg.fillStyle(0x6ee7ff, hover ? 0.16 : 0.06);
        bg.fillRoundedRect(x - 19, rowTwo - 19, 38, 38, 10);
        bg.lineStyle(1, 0x6ee7ff, hover ? 1 : 0.45);
        bg.strokeRoundedRect(x - 19, rowTwo - 19, 38, 38, 10);
      };
      draw(false);
      const text = this.add
        .text(x, rowTwo, glyph, {
          fontFamily: FONT_MONO,
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#9fe9ff',
        })
        .setOrigin(0.5);
      const hit = this.add
        .rectangle(x, rowTwo, 38, 38, 0x000000, 0.001)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => draw(true));
      hit.on('pointerout', () => draw(false));
      hit.on('pointerup', () => {
        audio.unlock();
        audio.setVolume(audio.volume + delta);
        audio.play('click');
        drawVolume();
      });
      container.add([bg, text, hit]);
    };

    volumeButton(width / 2 + 130, '-', -AUDIO.volumeStep);
    volumeButton(width / 2 + 290, '+', AUDIO.volumeStep);
    container.add(volumeLabel);

  }

  /**
   * Arena layout picker. It lives in its own panel rather than inside Options, so the menu panels
   * stay about one thing each: settings, the map table, the rules, and the Know Your Enemy numbers.
   */
  private openMaps(): void {
    const panelHeight = 462;
    const container = this.openOverlay('ARENA MAPS', panelHeight);
    const { width, height } = VIEWPORT;
    const top = (height - panelHeight) / 2;
    const cardWidth = 620;
    const cardHeight = 84;
    const left = (width - cardWidth) / 2;
    const firstCard = top + 86;
    const previewWidth = 150;
    const previewHeight = 58;

    let selected = getMap(loadMapId()).id;
    const repaint: Array<() => void> = [];

    /** Thumbnail of the layout: the real obstacle rectangles from maps.json, scaled to fit. */
    const drawPreview = (map: GameMap, x: number, y: number): Phaser.GameObjects.Graphics => {
      const graphics = this.add.graphics();
      graphics.fillStyle(COLORS.floor, 1);
      graphics.fillRoundedRect(x, y, previewWidth, previewHeight, 6);
      graphics.lineStyle(1, COLORS.wall, 1);
      graphics.strokeRoundedRect(x, y, previewWidth, previewHeight, 6);
      graphics.fillStyle(COLORS.wallGlow, 1);
      const scaleX = previewWidth / ARENA.width;
      const scaleY = previewHeight / ARENA.height;
      for (const block of map.obstacles) {
        graphics.fillRect(
          x + block.x * scaleX,
          y + block.y * scaleY,
          Math.max(2, block.width * scaleX),
          Math.max(2, block.height * scaleY),
        );
      }
      return graphics;
    };

    MAPS.maps.forEach((map, index) => {
      const y = firstCard + index * (cardHeight + 12);
      const bg = this.add.graphics();
      const name = this.add
        .text(left + 26, y + 28, map.name, {
          fontFamily: FONT_FAMILY,
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#9fe9ff',
        })
        .setOrigin(0, 0.5);
      name.setLetterSpacing(2);

      const detail = this.add
        .text(
          left + 26,
          y + 56,
          map.obstacles.length === 0
            ? 'open ground · nowhere to hide'
            : `${map.obstacles.length} cover blocks · stop shots and movement`,
          {
            fontFamily: FONT_MONO,
            fontSize: '12px',
            color: '#7d95a6',
          },
        )
        .setOrigin(0, 0.5);

      const preview = drawPreview(map, left + cardWidth - previewWidth - 26, y + 13);

      const hit = this.add
        .rectangle(left + cardWidth / 2, y + cardHeight / 2, cardWidth, cardHeight, 0x000000, 0.001)
        .setInteractive({ useHandCursor: true });

      const draw = (hover: boolean): void => {
        const picked = map.id === selected;
        bg.clear();
        bg.fillStyle(picked ? 0x6ee7ff : 0x11212c, hover ? 0.16 : picked ? 0.1 : 0.55);
        bg.fillRoundedRect(left, y, cardWidth, cardHeight, 12);
        bg.lineStyle(picked ? 2 : 1, picked ? 0x6ee7ff : 0x2b4457, picked ? 1 : 0.8);
        bg.strokeRoundedRect(left, y, cardWidth, cardHeight, 12);
        name.setColor(picked ? '#ffffff' : hover ? '#dffaff' : '#9fe9ff');
      };
      draw(false);

      hit.on('pointerover', () => draw(true));
      hit.on('pointerout', () => draw(false));
      hit.on('pointerup', () => {
        selected = map.id;
        saveMapId(map.id);
        audio.play('click');
        repaint.forEach((paint) => paint());
      });

      container.add([bg, name, detail, preview, hit]);
      repaint.push(() => draw(false));
    });

    container.add(
      this.add
        .text(
          width / 2,
          top + panelHeight - 64,
          'the layout you pick is used for every run until you change it',
          {
            fontFamily: FONT_MONO,
            fontSize: '12px',
            color: '#5f798b',
          },
        )
        .setOrigin(0.5),
    );
  }

  private openHelp(): void {
    // Ten hostile rows at a 30 px step need the height, and the two-line ABILITIES rows need 44 px
    // between names to read as airy as the one-line lists below them. 672 pays for both and still
    // leaves ~34 px between the last row and the CLOSE hint.
    const panelHeight = 672;
    const container = this.openOverlay('HOW TO PLAY', panelHeight);
    const { width, height } = VIEWPORT;
    const top = (height - panelHeight) / 2;
    const left = width / 2 - 300;
    const right = width / 2 + 40;

    const section = (x: number, y: number, text: string): void => {
      const label = this.add.text(x, y, text, {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        fontStyle: 'bold',
        color: COLORS.textDim,
      });
      label.setLetterSpacing(2);
      container.add(label);
    };

    /** One legend line: the in-game icon, its name, and a short explanation. */
    const legendRow = (
      x: number,
      y: number,
      iconKey: string,
      iconSize: number,
      name: string,
      nameColor: string,
      detail: string,
    ): void => {
      container.add([
        this.add.image(x + 9, y, iconKey).setDisplaySize(iconSize, iconSize),
        this.add
          .text(x + 26, y, name, {
            fontFamily: FONT_MONO,
            fontSize: '12px',
            fontStyle: 'bold',
            color: nameColor,
          })
          .setOrigin(0, 0.5),
        this.add
          .text(x + 130, y, detail, {
            fontFamily: FONT_MONO,
            fontSize: '11px',
            color: '#7d95a6',
          })
          .setOrigin(0, 0.5),
      ]);
    };

    section(left, top + 76, 'CONTROLS');
    const controls: Array<[string, string]> = [
      ['WASD / ARROWS', 'move'],
      ['MOUSE', 'aim'],
      ['HOLD LEFT CLICK', 'shoot'],
      ['RIGHT CLICK', 'throw bomb'],
      ['SPACE', 'dash toward aim'],
      ['1 2 3 / WHEEL', 'switch weapon'],
      ['ESC', 'pause'],
      ['M', 'mute / unmute music'],
      ['N', 'mute / unmute sound'],
    ];

    // Nine rows split 5/4, so the step tightens a little to keep clear of the ABILITIES heading.
    const rowsPerColumn = Math.ceil(controls.length / 2);
    controls.forEach(([key, action], index) => {
      const x = index < rowsPerColumn ? left + 8 : right + 8;
      const y = top + 94 + (index % rowsPerColumn) * 22;
      container.add([
        this.add
          .text(x, y, key, {
            fontFamily: FONT_MONO,
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#9fe9ff',
          })
          .setOrigin(0, 0.5),
        this.add
          .text(x + 124, y, action, {
            fontFamily: FONT_MONO,
            fontSize: '13px',
            color: '#7d95a6',
          })
          .setOrigin(0, 0.5),
      ]);
    });

    // Ability rows: the title line carries the binding, the line under it what the ability does and
    // how it is rationed. Counts and refill times are read from config, so tuning stays in one place.
    section(left, top + 202, 'ABILITIES');
    const abilities: Array<[string, string, string, string]> = [
      [
        'BOMB',
        'RIGHT CLICK',
        COLORS.bomb,
        `flies to your cursor, blasts a radius · ${BOMB.startingCharges} in hand, ${BOMB.maxCharges} max · +1 every ${BOMB.chargeMs / 1000}s`,
      ],
      [
        'DASH',
        'SPACE',
        COLORS.dash,
        `bursts toward your aim, no damage taken · ${DASH.maxCharges} charges · +1 every ${DASH.chargeMs / 1000}s`,
      ],
    ];

    abilities.forEach(([name, key, color, detail], index) => {
      // Two lines per row, so the step is wider than the one-line lists below: 16 px between the
      // name and its detail, and ~16 px of daylight before the next ability.
      const y = top + 222 + index * 44;
      container.add([
        this.add
          .text(left + 8, y, name, {
            fontFamily: FONT_MONO,
            fontSize: '13px',
            fontStyle: 'bold',
            color,
          })
          .setOrigin(0, 0.5),
        this.add
          .text(left + 72, y, key, {
            fontFamily: FONT_MONO,
            fontSize: '11px',
            color: '#7d95a6',
          })
          .setOrigin(0, 0.5),
        this.add
          .text(left + 8, y + 16, detail, {
            fontFamily: FONT_MONO,
            fontSize: '11px',
            color: '#c8dbe8',
          })
          .setOrigin(0, 0.5),
      ]);
    });

    section(left, top + 306, 'DROPS');
    const drops: Array<[keyof typeof PICKUPS.textureFor, string, string, string]> = [
      ['health', 'HEALTH', '#4ade80', `+${PICKUPS.healthAmount} HP`],
      ['vitality', 'MAX HP', COLORS.vitality, `+${PICKUPS.vitalityAmount} max HP`],
      ['weapon', 'WEAPON', '#5ce1ff', 'gun unlock / +damage'],
      [
        'multiplier',
        'SCORE',
        COLORS.multiplier,
        `x${PICKUPS.multiplierFactor} score · ${PICKUPS.multiplierDurationMs / 1000}s`,
      ],
      [
        'damage',
        'DAMAGE',
        COLORS.damage,
        `x${PICKUPS.damageFactor} damage · ${PICKUPS.damageDurationMs / 1000}s`,
      ],
      ['shield', 'SHIELD', COLORS.shield, `invulnerable · ${PICKUPS.shieldDurationMs / 1000}s`],
      ['buddy', 'BUDDY', COLORS.buddy, `ally clone · ${BUDDY.durationMs / 1000}s`],
    ];

    drops.forEach(([kind, name, color, detail], index) => {
      legendRow(left + 8, top + 334 + index * 30, PICKUPS.textureFor[kind], 22, name, color, detail);
    });

    section(right, top + 306, 'HOSTILES');
    const hostiles: Array<{ icon: string; name: string; detail: string; size: number }> = [
      { icon: ENEMY_SPECS.chaser.texture, name: 'CHASER', detail: 'walks straight at you', size: 22 },
      { icon: ENEMY_SPECS.runner.texture, name: 'RUNNER', detail: 'fast, fragile, weaves', size: 22 },
      { icon: ENEMY_SPECS.tank.texture, name: 'TANK', detail: 'slow but very tough', size: 22 },
      { icon: ENEMY_SPECS.shooter.texture, name: 'SHOOTER', detail: 'keeps range, fires', size: 22 },
      { icon: ENEMY_SPECS.shocker.texture, name: 'SHOCKER', detail: 'jolt jams your gun', size: 22 },
      {
        icon: ENEMY_SPECS.cloner.texture,
        name: 'CLONER',
        detail: 'clones other enemies',
        size: 22,
      },
      { icon: ENEMY_SPECS.bomber.texture, name: 'BOMBER', detail: 'Kaboom, heavy damage', size: 22 },
      { icon: ENEMY_SPECS.healer.texture, name: 'HEALER', detail: `heals ${HEALER.healAmount} HP nearby`, size: 22 },
      { icon: ENEMY_SPECS.teleporter.texture, name: 'TELEPORTER', detail: 'teleports when far', size: 22 },
      { icon: BOSS.texture, name: 'OVERSHARD', detail: 'boss · radial bursts', size: 24 },
    ];

    hostiles.forEach((hostile, index) => {
      legendRow(
        right + 8,
        top + 334 + index * 30,
        hostile.icon,
        hostile.size,
        hostile.name,
        '#c8dbe8',
        hostile.detail,
      );
    });

    // The roster above is the one-line summary; the numbers live in their own panel, so this one
    // stays about how to play.
    const knowYourEnemyLink = this.add
      .text(left + 8, top + panelHeight - 32, 'KNOW YOUR ENEMY  ·  STATS', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#9fe9ff',
      })
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });
    knowYourEnemyLink.on('pointerover', () => knowYourEnemyLink.setColor('#ffffff'));
    knowYourEnemyLink.on('pointerout', () => knowYourEnemyLink.setColor('#9fe9ff'));
    knowYourEnemyLink.on('pointerup', () => {
      audio.play('click');
      // Opening the table destroys the overlay that owns this text, so let the click finish first.
      this.time.delayedCall(0, () => this.openKnowYourEnemy());
    });
    container.add(knowYourEnemyLink);
  }

  /**
   * The numbers behind the roster: base stats for every enemy, read straight from config and
   * `waves.json` so the table cannot drift from the tuning values. Health is the wave-1 base; the
   * header states the per-wave growth.
   */
  private openKnowYourEnemy(): void {
    const panelWidth = 940;
    const panelHeight = 500;
    const container = this.openOverlay('KNOW YOUR ENEMY', panelHeight, panelWidth);
    const { width, height } = VIEWPORT;
    // Outside a run there is no wave to scale to, so the menu shows the wave-1 base numbers; the
    // HUD's copy (pressed mid-run) is the one that tracks the wave being fought.
    renderKnowYourEnemy(this, container, {
      left: (width - panelWidth) / 2,
      top: (height - panelHeight) / 2,
      width: panelWidth,
      height: panelHeight,
      wave: 1,
    });
  }
}
