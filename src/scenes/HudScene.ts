import Phaser from 'phaser';
import { renderKnowYourEnemy } from './KnowYourEnemyPanel';
import {
  BOMB,
  DASH,
  VIEWPORT,
  COLORS,
  FONT_FAMILY,
  FONT_MONO,
  PICKUPS,
  WEAPONS,
  WEAPONS_DATA,
  type WeaponId,
} from '../config';
import { audio } from '../systems/AudioManager';
import { formatBuffSeconds } from '../systems/Buffs';
import type { BannerMessage, GameScene } from './GameScene';

interface WeaponSlot {
  id: WeaponId;
  box: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

/** One rack of charge pips (bombs, dashes): a caption, the pips, and a refill readout. */
interface ChargeMeter {
  pips: Phaser.GameObjects.Rectangle[];
  fill: Phaser.GameObjects.Graphics;
  timer: Phaser.GameObjects.Text;
  max: number;
  chargeMs: number;
  /** Fill tint while charged, and the brighter head on the pip that is refilling. */
  pipTint: number;
  headTint: number;
  readyColor: string;
  /** What the rack looked like last frame, so it only redraws when a pip actually changes. */
  lastCharges: number;
  lastStep: number;
  lastTimer: string;
}

/** One countdown row's last drawn state: the visible tenth of a second, and whether it was shown. */
interface TimedRowShown {
  tenths: number;
  visible: boolean;
}

/**
 * What the HUD actually drew last frame. Every value is compared before a draw, so a steady number
 * never touches a canvas; the bars keep a whole-pixel width and the rows a rounded tenth.
 */
interface HudShown {
  healthPx: number;
  lowHealth: boolean;
  health: number;
  score: number;
  multiplier: TimedRowShown;
  damage: TimedRowShown;
  shield: TimedRowShown;
  disarm: TimedRowShown;
  buddy: TimedRowShown;
  wave: number;
  kills: number;
  breakTenths: number;
  breakFirst: boolean;
  bossPx: number;
  bossLabel: string;
  bossPhase: string;
  bossPhaseColor: string;
  slotCurrent: WeaponId | null;
  slotOwned: number;
  hintMusic: boolean | null;
  hintMuted: boolean | null;
}

const freshTimedRow = (): TimedRowShown => ({ tenths: -1, visible: false });

/** Everything starts unlike any real value, so the first frame draws the whole HUD. */
const freshShown = (): HudShown => ({
  healthPx: -1,
  lowHealth: false,
  health: -1,
  score: -1,
  multiplier: freshTimedRow(),
  damage: freshTimedRow(),
  shield: freshTimedRow(),
  disarm: freshTimedRow(),
  buddy: freshTimedRow(),
  wave: -1,
  kills: -1,
  breakTenths: -1,
  breakFirst: false,
  bossPx: -2,
  bossLabel: '\u0000',
  bossPhase: '\u0000',
  bossPhaseColor: '\u0000',
  slotCurrent: null,
  slotOwned: -1,
  hintMusic: null,
  hintMuted: null,
});

/**
 * Overlay scene: it owns the HUD and the pause menu. The pause panel carries the controls, so no
 * instructions are ever drawn over a running wave.
 * Continuous values are polled from GameScene each frame; transient messages
 * come through GameScene's banner queue.
 */
export class HudScene extends Phaser.Scene {
  private healthBar!: Phaser.GameObjects.Graphics;
  private healthValue!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private damageBuffText!: Phaser.GameObjects.Text;
  private shieldText!: Phaser.GameObjects.Text;
  private disarmText!: Phaser.GameObjects.Text;
  private buddyText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossLabel!: Phaser.GameObjects.Text;
  private bossPhase!: Phaser.GameObjects.Text;
  private breakText!: Phaser.GameObjects.Text;
  private bannerTitle!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private weaponSlots: WeaponSlot[] = [];
  private bombMeter!: ChargeMeter;
  private dashMeter!: ChargeMeter;
  private pauseLayer!: Phaser.GameObjects.Container;
  /** The mid-run Know Your Enemy table, shown over the game and torn down when closed. */
  private knowYourEnemyLayer?: Phaser.GameObjects.Container;
  private pauseSoundToggle?: Phaser.GameObjects.Container;
  private pauseMusicToggle?: Phaser.GameObjects.Container;
  private hintText!: Phaser.GameObjects.Text;
  private soundButtonBg!: Phaser.GameObjects.Graphics;
  private soundButtonLabel!: Phaser.GameObjects.Text;
  private soundButtonDraw?: (hover: boolean) => void;
  /** Last drawn state of every cached HUD part. */
  private shown: HudShown = freshShown();

  constructor() {
    super('HudScene');
  }

  create(): void {
    this.weaponSlots = [];
    this.shown = freshShown();

    const caption = (x: number, y: number, text: string, originX = 0): Phaser.GameObjects.Text =>
      this.add
        .text(x, y, text, {
          fontFamily: FONT_MONO,
          fontSize: '11px',
          color: '#6b8497',
        })
        .setOrigin(originX, 0)
        .setLetterSpacing(2);

    caption(28, 22, 'HEALTH');
    this.healthBar = this.add.graphics();
    this.healthValue = this.add
      .text(180, 48, '100', {
        fontFamily: FONT_MONO,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#eafff2',
      })
      .setOrigin(0.5);

    caption(VIEWPORT.width / 2, 16, 'SCORE', 0.5);
    this.scoreText = this.add
      .text(VIEWPORT.width / 2, 32, '0', {
        fontFamily: FONT_MONO,
        fontSize: '30px',
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(0.5, 0)
      .setShadow(0, 0, '#38d9ff', 14, true, true);

    this.multiplierText = this.add
      .text(VIEWPORT.width / 2, 74, '', {
        fontFamily: FONT_MONO,
        fontSize: '14px',
        fontStyle: 'bold',
        color: COLORS.multiplier,
      })
      .setOrigin(0.5, 0);

    // Active pick-up buffers sit under the health bar, where nothing else is drawn.
    this.damageBuffText = this.add
      .text(28, 66, '', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        fontStyle: 'bold',
        color: COLORS.damage,
      })
      .setVisible(false)
      .setLetterSpacing(1);

    this.shieldText = this.add
      .text(28, 84, '', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        fontStyle: 'bold',
        color: COLORS.shield,
      })
      .setVisible(false)
      .setLetterSpacing(1);

    // Shocker jolt: the weapon is locked out, and the row counts the lock down.
    this.disarmText = this.add
      .text(28, 102, '', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        fontStyle: 'bold',
        color: COLORS.disarm,
      })
      .setVisible(false)
      .setLetterSpacing(1);
    // The battle buddy's lease: one more row under the other timed drops.
    this.buddyText = this.add
      .text(28, 120, '', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        fontStyle: 'bold',
        color: COLORS.buddy,
      })
      .setVisible(false)
      .setLetterSpacing(1);

    caption(VIEWPORT.width - 28, 16, 'WAVE', 1);    this.waveText = this.add
      .text(VIEWPORT.width - 28, 32, '1', {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(1, 0);

    this.killsText = this.add
      .text(VIEWPORT.width - 28, 72, '0 KILLS', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: '#6b8497',
      })
      .setOrigin(1, 0);

    this.bossBar = this.add.graphics();
    this.bossLabel = this.add
      .text(VIEWPORT.width / 2, 96, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#ff8fa3',
      })
      .setOrigin(0.5)
      .setLetterSpacing(3)
      .setVisible(false);

    // Sits on the right cap of the boss bar, naming the attack that is running right now.
    this.bossPhase = this.add
      .text(VIEWPORT.width / 2 + 240, 96, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: COLORS.accent,
      })
      .setOrigin(1, 0.5)
      .setLetterSpacing(2)
      .setVisible(false);

    this.createWeaponSlots();
    this.bombMeter = this.createChargeMeter(
      'BOMB · RIGHT CLICK',
      VIEWPORT.width - 28,
      1,
      VIEWPORT.width - 28 - (BOMB.maxCharges * 32 - 6),
      586,
      {
        max: BOMB.maxCharges,
        chargeMs: BOMB.chargeMs,
        pipTint: 0xffd166,
        headTint: 0xfff0b0,
        readyColor: COLORS.bomb,
      },
    );
    this.dashMeter = this.createChargeMeter('DASH · SPACE', 28, 0, 28, 586, {
      max: DASH.maxCharges,
      chargeMs: DASH.chargeMs,
      pipTint: 0x6ee7ff,
      headTint: 0xd7f7ff,
      readyColor: COLORS.dash,
    });

    this.breakText = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height - 62, '', {
        fontFamily: FONT_MONO,
        fontSize: '14px',
        color: COLORS.textDim,
      })
      .setOrigin(0.5)
      .setLetterSpacing(2);

    this.hintText = this.add
      .text(
        VIEWPORT.width - 24,
        VIEWPORT.height - 18,
        'ESC PAUSE   ·   M MUSIC   ·   N SOUND   ·   RIGHT CLICK BOMB   ·   SPACE DASH',
        {
          fontFamily: FONT_MONO,
          fontSize: '11px',
          color: '#4d6373',
        },
      )
      .setOrigin(1, 1);

    this.bannerSub = this.add
      .text(VIEWPORT.width / 2, 276, '', {
        fontFamily: FONT_MONO,
        fontSize: '14px',
        color: COLORS.textDim,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setLetterSpacing(4);

    this.bannerTitle = this.add
      .text(VIEWPORT.width / 2, 236, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '46px',
        fontStyle: 'bold',
        color: COLORS.accent,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setLetterSpacing(4)
      .setShadow(0, 0, '#38d9ff', 22, true, true);

    // Sits above the wave counter and below the pause layer, so muting never needs a pause.
    this.createSoundButton();
    this.createPauseLayer();

    this.input.keyboard?.on('keydown-ESC', this.togglePause, this);
    this.input.keyboard?.on('keydown-M', this.toggleMusicKey, this);
    this.input.keyboard?.on('keydown-N', this.toggleMute, this);
    this.input.keyboard?.on('keydown-B', this.toggleKnowYourEnemy, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ESC', this.togglePause, this);
      this.input.keyboard?.off('keydown-M', this.toggleMusicKey, this);
      this.input.keyboard?.off('keydown-N', this.toggleMute, this);
      this.input.keyboard?.off('keydown-B', this.toggleKnowYourEnemy, this);
      // The flag lives on the run scene; a stale one would block firing after a restart.
      this.setHudPointerOver(false);
    });
  }

  update(): void {
    const game = this.gameScene;
    if (!game) return;

    const state = game.hudState;
    const shown = this.shown;

    this.drawHealthBar(state.health, state.maxHealth);
    if (state.health !== shown.health) {
      shown.health = state.health;
      this.healthValue.setText(`${state.health}`);
    }

    if (state.score !== shown.score) {
      shown.score = state.score;
      this.scoreText.setText(state.score.toLocaleString());
    }

    this.updateTimedRow(this.multiplierText, state.multiplierMs, shown.multiplier, `x${state.multiplier}`);
    this.updateTimedRow(this.damageBuffText, state.damageMs, shown.damage, `DAMAGE x${PICKUPS.damageFactor}`);
    this.updateTimedRow(this.shieldText, state.shieldMs, shown.shield, 'SHIELD');
    this.updateTimedRow(this.disarmText, state.disarmMs, shown.disarm, 'WEAPON JAMMED');
    this.updateTimedRow(this.buddyText, state.buddyMs, shown.buddy, 'BATTLE BUDDY');

    if (state.wave !== shown.wave) {
      shown.wave = state.wave;
      this.waveText.setText(`${Math.max(1, state.wave)}`);
    }

    if (state.kills !== shown.kills) {
      shown.kills = state.kills;
      this.killsText.setText(`${state.kills} KILL${state.kills === 1 ? '' : 'S'}`);
    }

    this.drawBossBar(state.bossRatio, state.bossLabel, state.bossPhase);

    const breakVisible = state.breakMs > 0;
    const breakTenths = breakVisible ? Math.round(state.breakMs / 100) : -1;
    const firstWave = state.wave === 0;
    if (breakTenths !== shown.breakTenths || firstWave !== shown.breakFirst) {
      shown.breakTenths = breakTenths;
      shown.breakFirst = firstWave;
      this.breakText.setVisible(breakVisible);
      if (breakVisible) {
        const seconds = (state.breakMs / 1000).toFixed(1);
        this.breakText.setText(`${firstWave ? 'FIRST WAVE' : 'NEXT WAVE'} IN ${seconds}`);
      }
    }

    // Owned weapons only ever grow, so the current gun plus the count identifies the rack.
    if (state.weaponId !== shown.slotCurrent || state.weapons.length !== shown.slotOwned) {
      shown.slotCurrent = state.weaponId;
      shown.slotOwned = state.weapons.length;
      this.updateWeaponSlots(state.weaponId, state.weapons);
    }

    this.updateChargeMeter(this.bombMeter, state.bombCharges, state.bombChargeMs);
    this.updateChargeMeter(this.dashMeter, state.dashCharges, state.dashChargeMs);

    if (audio.isMusicEnabled !== shown.hintMusic || audio.isMuted !== shown.hintMuted) {
      shown.hintMusic = audio.isMusicEnabled;
      shown.hintMuted = audio.isMuted;
      this.hintText.setText(
        `ESC PAUSE   ·   M MUSIC ${audio.isMusicEnabled ? 'ON' : 'OFF'}   ·   N SOUND ${audio.isMuted ? 'OFF' : 'ON'}` +
          '   ·   RIGHT CLICK BOMB   ·   SPACE DASH',
      );
    }

    const banner = game.takeBanner();
    if (banner) this.showBanner(banner);
  }

  /**
   * Countdown rows (buffs and the break timer): rebuild the label only when the visible tenth of a
   * second changes, and flip visibility only when it flips, so a steady row costs nothing.
   */
  private updateTimedRow(
    text: Phaser.GameObjects.Text,
    ms: number,
    slot: TimedRowShown,
    prefix: string,
  ): void {
    const visible = ms > 0;
    const tenths = visible ? Math.round(ms / 100) : -1;
    if (visible === slot.visible && tenths === slot.tenths) return;
    slot.visible = visible;
    slot.tenths = tenths;
    text.setVisible(visible);
    if (visible) text.setText(`${prefix}  ${formatBuffSeconds(ms)}`);
  }

  /* ------------------------------------------------------------------ parts */

  private get gameScene(): GameScene | null {
    const scene = this.scene.get('GameScene') as GameScene | undefined;
    if (!scene) return null;
    const active = this.scene.isActive('GameScene') || this.scene.isPaused('GameScene');
    return active ? scene : null;
  }

  private drawHealthBar(health: number, maxHealth: number): void {
    const ratio = maxHealth > 0 ? Phaser.Math.Clamp(health / maxHealth, 0, 1) : 0;
    const x = 28;
    const y = 38;
    const width = 300;
    const height = 20;
    // A whole-pixel width plus whether the low-health colour is on: anything finer is invisible.
    const fillWidth = Math.round((width - 4) * ratio);
    const low = ratio <= 0.35;
    const shown = this.shown;
    if (fillWidth === shown.healthPx && low === shown.lowHealth) return;
    shown.healthPx = fillWidth;
    shown.lowHealth = low;

    const bar = this.healthBar;
    bar.clear();
    bar.fillStyle(0x080d12, 0.85);
    bar.fillRoundedRect(x, y, width, height, 7);
    if (fillWidth > 0) {
      bar.fillStyle(low ? COLORS.healthLow : COLORS.health, 1);
      bar.fillRoundedRect(x + 2, y + 2, Math.max(2, fillWidth), height - 4, 5);
      bar.fillStyle(0xffffff, 0.16);
      bar.fillRoundedRect(x + 2, y + 2, Math.max(2, fillWidth), (height - 4) / 2, 4);
    }
    bar.lineStyle(1, 0x2b4457, 1);
    bar.strokeRoundedRect(x, y, width, height, 7);
  }

  private drawBossBar(
    ratio: number,
    label: string | null,
    phase: { text: string; color: string } | null,
  ): void {
    const width = 480;
    const labelText = label ?? '';
    const phaseText = phase?.text ?? '';
    const phaseColor = phase?.color ?? '';
    const fillWidth = label && ratio > 0 ? Math.round((width - 4) * ratio) : -1;
    const shown = this.shown;

    if (
      fillWidth === shown.bossPx &&
      labelText === shown.bossLabel &&
      phaseText === shown.bossPhase &&
      phaseColor === shown.bossPhaseColor
    ) {
      return;
    }

    shown.bossPx = fillWidth;
    shown.bossLabel = labelText;
    shown.bossPhase = phaseText;
    shown.bossPhaseColor = phaseColor;

    const bar = this.bossBar;
    bar.clear();

    if (fillWidth < 0) {
      this.bossLabel.setVisible(false);
      this.bossPhase.setVisible(false);
      return;
    }

    const height = 12;
    const x = (VIEWPORT.width - width) / 2;
    const y = 112;

    this.bossLabel.setText(labelText).setVisible(true);
    if (phase) {
      this.bossPhase.setText(phaseText).setColor(phaseColor).setVisible(true);
    } else {
      this.bossPhase.setVisible(false);
    }

    bar.fillStyle(0x080d12, 0.9);
    bar.fillRoundedRect(x, y, width, height, 6);
    bar.fillStyle(0xff3d6b, 1);
    bar.fillRoundedRect(x + 2, y + 2, Math.max(2, fillWidth), height - 4, 4);
    bar.lineStyle(1, 0x6b1730, 1);
    bar.strokeRoundedRect(x, y, width, height, 6);
  }

  private createWeaponSlots(): void {
    WEAPONS_DATA.order.forEach((id, index) => {
      const x = 30 + index * 142;
      const y = VIEWPORT.height - 66;
      const box = this.add
        .rectangle(x, y, 132, 40, 0x0b131b, 0.75)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0x24394a, 1);
      const label = this.add
        .text(x + 10, y + 20, '', {
          fontFamily: FONT_MONO,
          fontSize: '12px',
          color: '#6b8497',
        })
        .setOrigin(0, 0.5);
      this.weaponSlots.push({ id, box, label });
    });
  }

  /**
   * One rack of pips: the caption sits above and the refill readout below, both aligned to the
   * same edge as the pips so bombs (right) and dashes (left) mirror each other.
   */
  private createChargeMeter(
    caption: string,
    captionX: number,
    captionOriginX: 0 | 1,
    startX: number,
    /** Top edge of the caption; the pips and the refill readout sit below it at fixed offsets. */
    captionY: number,
    spec: {
      max: number;
      chargeMs: number;
      pipTint: number;
      headTint: number;
      readyColor: string;
    },
  ): ChargeMeter {
    const pipWidth = 26;
    const gap = 6;

    // The caption wears the ability's own colour, so a label and its pips read as one unit rather
    // than as another grey HUD caption.
    this.add
      .text(captionX, captionY, caption, {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        fontStyle: 'bold',
        color: spec.readyColor,
      })
      .setOrigin(captionOriginX, 0)
      .setLetterSpacing(2);

    const pips: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < spec.max; i += 1) {
      pips.push(
        this.add
          .rectangle(startX + i * (pipWidth + gap), captionY + 30, pipWidth, 10, 0x101c26, 0.85)
          .setOrigin(0, 0.5)
          .setStrokeStyle(1, 0x2b4457, 1),
      );
    }

    const fill = this.add.graphics();
    const timer = this.add
      .text(captionX, captionY + 40, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#6b8497',
      })
      .setOrigin(captionOriginX, 0);

    return { pips, fill, timer, lastCharges: -1, lastStep: -1, lastTimer: '', ...spec };
  }

  private updateChargeMeter(meter: ChargeMeter, charges: number, chargeMs: number): void {
    // Pips fill left to right; the last one trickles in as the next charge builds.
    const progress =
      charges >= meter.max ? 1 : Phaser.Math.Clamp(1 - chargeMs / meter.chargeMs, 0, 1);
    const inset = 2;
    // Quantise the fill to whole pixels of the charging pip. Sub-pixel progress is invisible, so
    // redrawing only when a pixel actually changes turns ~900 redraws per refill into ~22.
    const step = Math.round(progress * (26 - inset * 2));

    if (charges !== meter.lastCharges || step !== meter.lastStep) {
      meter.lastCharges = charges;
      meter.lastStep = step;

      meter.fill.clear();
      meter.pips.forEach((pip, index) => {
        const charged = index < charges;
        const ratio = charged ? 1 : index === charges ? progress : 0;

        pip.setStrokeStyle(1, charged ? meter.headTint : 0x2b4457, 1);

        const width = Math.max(0, (pip.width - inset * 2) * ratio);
        if (width <= 0) return;

        const left = pip.x + inset;
        const top = pip.y - pip.height / 2 + inset;
        const height = pip.height - inset * 2;

        meter.fill.fillStyle(meter.pipTint, charged ? 0.95 : 0.5);
        meter.fill.fillRect(left, top, width, height);

        // A bright head on the charging pip, so the fill is legible even mid-way.
        if (!charged) {
          meter.fill.fillStyle(meter.headTint, 0.9);
          meter.fill.fillRect(left + width - 2, top, 2, height);
        }
      });
    }

    const timerText =
      charges >= meter.pips.length
        ? 'READY'
        : `+1 IN ${(chargeMs / 1000).toFixed(1)}s · ${Math.round(progress * 100)}%`;
    if (timerText !== meter.lastTimer) {
      meter.lastTimer = timerText;
      meter.timer.setText(timerText);
    }

    // Recolouring text re-rasterises it, so only touch it when the state actually flips.
    const timerColor = charges > 0 ? meter.readyColor : '#6b8497';
    if (meter.timer.style.color !== timerColor) meter.timer.setColor(timerColor);
  }

  private updateWeaponSlots(current: WeaponId, owned: WeaponId[]): void {
    for (const slot of this.weaponSlots) {
      const isOwned = owned.includes(slot.id);
      const isCurrent = slot.id === current;
      const name = WEAPONS[slot.id].name.toUpperCase();

      slot.box.setFillStyle(isCurrent ? 0x14313c : 0x0b131b, isCurrent ? 0.95 : 0.72);
      slot.box.setStrokeStyle(1, isCurrent ? 0x6ee7ff : 0x24394a, isCurrent ? 1 : 0.8);
      slot.label.setText(isOwned ? `${WEAPONS_DATA.order.indexOf(slot.id) + 1} · ${name}` : `${WEAPONS_DATA.order.indexOf(slot.id) + 1} · LOCKED`);
      slot.label.setColor(isCurrent ? '#dffaff' : isOwned ? '#8fa9ba' : '#42566a');
    }
  }

  private showBanner(banner: BannerMessage): void {
    const toneColor =
      banner.tone === 'boss' || banner.tone === 'danger'
        ? '#ff7d95'
        : banner.tone === 'wave'
          ? COLORS.accent
          : COLORS.multiplier;

    this.bannerTitle.setText(banner.text).setColor(toneColor).setScale(0.9).setAlpha(0);
    this.bannerSub.setText(banner.sub ?? '').setAlpha(0);

    this.tweens.killTweensOf(this.bannerTitle);
    this.tweens.killTweensOf(this.bannerSub);

    this.tweens.add({
      targets: this.bannerTitle,
      alpha: 1,
      scale: 1,
      duration: 170,
      ease: 'Quad.easeOut',
      hold: 780,
      yoyo: true,
    });
    this.tweens.add({
      targets: this.bannerSub,
      alpha: 0.9,
      duration: 200,
      ease: 'Quad.easeOut',
      hold: 760,
      yoyo: true,
    });
  }

  /* ------------------------------------------------------------------ pause */

  private createPauseLayer(): void {
    const width = VIEWPORT.width;
    const height = VIEWPORT.height;

    const backdrop = this.add.rectangle(0, 0, width, height, 0x04070a, 0.76).setOrigin(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x0b131b, 0.96);
    panel.fillRoundedRect(width / 2 - 230, height / 2 - 180, 460, 360, 18);
    panel.lineStyle(1, 0x2b4457, 1);
    panel.strokeRoundedRect(width / 2 - 230, height / 2 - 180, 460, 360, 18);

    const title = this.add
      .text(width / 2, height / 2 - 120, 'PAUSED', {
        fontFamily: FONT_FAMILY,
        fontSize: '46px',
        fontStyle: 'bold',
        color: '#eafcff',
      })
      .setOrigin(0.5)
      .setLetterSpacing(8)
      .setShadow(0, 0, '#38d9ff', 20, true, true);

    const lines = [
      'WASD / ARROWS   MOVE',
      'MOUSE           AIM',
      'LEFT CLICK      SHOOT',
      '1 2 3 / WHEEL   WEAPONS',
      'B       KNOW YOUR ENEMY',
    ];
    const controls = this.add
      .text(width / 2, height / 2 - 42, lines.join('\n'), {
        fontFamily: FONT_MONO,
        fontSize: '13px',
        color: '#8fa9ba',
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5);

    const resume = this.makeButton(width / 2, height / 2 + 52, 'RESUME', 0x6ee7ff, () => {
      this.resume();
    });
    const quit = this.makeButton(width / 2, height / 2 + 108, 'QUIT TO MENU', 0xff7d95, () => {
      audio.play('click');
      this.scene.stop('GameScene');
      this.scene.start('MenuScene');
    });

    // The same two switches as the menu corner: SOUND for every effect, MUSIC for the score.
    this.pauseSoundToggle = this.makeAudioToggle(width / 2 - 92, height / 2 + 154, 'sound');
    this.pauseMusicToggle = this.makeAudioToggle(width / 2 + 92, height / 2 + 154, 'music');

    backdrop.setInteractive({ useHandCursor: false });
    backdrop.on('pointerup', () => this.resume());

    this.pauseLayer = this.add
      .container(0, 0, [
        backdrop,
        panel,
        title,
        controls,
        resume,
        quit,
        this.pauseSoundToggle,
        this.pauseMusicToggle,
      ])
      .setDepth(100)
      .setVisible(false);
  }

  private makeButton(
    x: number,
    y: number,
    text: string,
    tint: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const label = this.add
      .text(0, 0, text, {
        fontFamily: FONT_MONO,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#dffaff',
      })
      .setOrigin(0.5);

    const draw = (hover: boolean): void => {
      bg.clear();
      bg.fillStyle(tint, hover ? 0.24 : 0.12);
      bg.fillRoundedRect(-130, -21, 260, 42, 12);
      bg.lineStyle(1, tint, hover ? 1 : 0.65);
      bg.strokeRoundedRect(-130, -21, 260, 42, 12);
    };
    draw(false);

    container.add([bg, label]);
    container.setSize(260, 42);
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
    return container;
  }

  /**
   * Compact ON/OFF switch for the pause panel, mirroring the menu's audio buttons. Effects and
   * music are separate, so silencing one leaves the other playing.
   */
  private makeAudioToggle(x: number, y: number, kind: 'sound' | 'music'): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const lamp = this.add.graphics();
    const label = this.add
      .text(16, 0, '', {
        fontFamily: FONT_MONO,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#dffaff',
      })
      .setOrigin(0.5);

    // The state is shown twice over: a lit/unlit lamp plus the word ON or OFF.
    const draw = (hover: boolean): void => {
      const on = kind === 'sound' ? !audio.isMuted : audio.isMusicEnabled;
      label.setText(`${kind === 'sound' ? 'SOUND' : 'MUSIC'}  ${on ? 'ON' : 'OFF'}`);
      label.setColor(on ? '#dffaff' : '#7d95a6');

      bg.clear();
      bg.fillStyle(on ? 0x6ee7ff : 0x0a131b, on ? (hover ? 0.3 : 0.18) : 0.95);
      bg.fillRoundedRect(-88, -20, 176, 40, 12);
      bg.lineStyle(on ? 2 : 1, on ? 0x6ee7ff : 0x33475a, 1);
      bg.strokeRoundedRect(-88, -20, 176, 40, 12);

      lamp.clear();
      lamp.fillStyle(on ? 0x6ee7ff : 0x33475a, 1);
      lamp.fillCircle(-64, 0, 6);
    };
    draw(false);

    container.add([bg, lamp, label]);
    container.setSize(176, 40);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerover', () => draw(true));
    container.on('pointerout', () => draw(false));
    // Same helpers as the M/N keys and every other switch, so the click feedback matches too.
    container.on('pointerup', () => {
      if (kind === 'sound') audio.toggleSoundBus();
      else audio.toggleMusicBus();
      this.refreshPauseAudio();
    });

    container.setData('redraw', draw);
    return container;
  }

  /** Repaints both pause switches from the audio manager's current state. */
  private refreshPauseAudio(): void {
    for (const toggle of [this.pauseSoundToggle, this.pauseMusicToggle]) {
      const redraw = toggle?.getData('redraw') as ((hover: boolean) => void) | undefined;
      if (redraw) redraw(false);
    }
    this.soundButtonDraw?.(false);
  }

  /**
   * The in-run SOUND switch: a click target on the HUD itself, beside the wave counter. It rides the
   * same audio state as the menu and pause switches and the N key, so all four always agree. While
   * the pointer sits on it the run stops treating a held button as fire.
   */
  private createSoundButton(): void {
    const width = 104;
    const height = 26;
    const x = VIEWPORT.width - 28 - width;
    const y = 92;

    this.soundButtonBg = this.add.graphics();
    this.soundButtonLabel = this.add
      .text(x + width / 2, y + height / 2, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        fontStyle: 'bold',
        color: COLORS.accent,
      })
      .setOrigin(0.5)
      .setLetterSpacing(2);

    // A near-invisible hit area over the pill: the artwork itself is a Graphics object, which has
    // no input shape of its own.
    const hit = this.add
      .rectangle(x, y, width, height, 0x000000, 0.001)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });

    const draw = (hover: boolean): void => {
      const on = !audio.isMuted;
      const bg = this.soundButtonBg;
      bg.clear();
      bg.fillStyle(0x0b131b, hover ? 0.95 : 0.72);
      bg.fillRoundedRect(x, y, width, height, 8);
      bg.lineStyle(1, on ? 0x2f6b7d : 0x24394a, 1);
      bg.strokeRoundedRect(x, y, width, height, 8);
      this.soundButtonLabel.setText(`SOUND ${on ? 'ON' : 'OFF'}`);
      this.soundButtonLabel.setColor(on ? COLORS.accent : '#7d95a6');
    };

    hit.on('pointerover', () => {
      draw(true);
      this.setHudPointerOver(true);
    });
    hit.on('pointerout', () => {
      draw(false);
      this.setHudPointerOver(false);
    });
    hit.on('pointerup', () => {
      audio.toggleSoundBus();
      draw(false);
      this.refreshPauseAudio();
    });

    this.soundButtonDraw = draw;
    draw(false);
  }

  /** Tells the run whether the pointer is parked on a HUD control (see `GameScene.pointerOverHud`). */
  private setHudPointerOver(over: boolean): void {
    const game = this.scene.get('GameScene') as GameScene | undefined;
    game?.setPointerOverHud(over);
  }

  private togglePause(): void {
    const game = this.gameScene;
    if (!game || game.isRunOver) return;
    // ESC backs out of the table first, so it never stacks the pause panel on top of it.
    if (this.knowYourEnemyLayer) {
      this.closeKnowYourEnemy();
      return;
    }

    if (this.scene.isPaused('GameScene')) {
      this.resume();
    } else {
      audio.play('click');
      this.scene.pause('GameScene');
      // Parking the pointer on the sound switch must not survive the pause: the panel covers it,
      // so no pointerout would ever arrive and the trigger would stay dead after resuming.
      this.setHudPointerOver(false);
      this.refreshPauseAudio();
      this.pauseLayer.setVisible(true);
    }
  }

  private resume(): void {
    if (!this.scene.isPaused('GameScene')) {
      this.pauseLayer.setVisible(false);
      return;
    }
    audio.play('click');
    this.scene.resume('GameScene');
    this.pauseLayer.setVisible(false);
  }

  /**
   * Mid-run Know Your Enemy: the same table the menu shows, but with health scaled to the wave being
   * fought. The run pauses while it is open, the way the pause panel does.
   */
  private toggleKnowYourEnemy(): void {
    if (this.knowYourEnemyLayer) {
      this.closeKnowYourEnemy();
      return;
    }

    const game = this.gameScene;
    if (!game || game.isRunOver) return;
    const wave = game.hudState.wave;
    if (!this.scene.isPaused('GameScene')) this.scene.pause('GameScene');
    audio.play('click');

    const width = VIEWPORT.width;
    const height = VIEWPORT.height;
    const panelWidth = 940;
    const panelHeight = 500;
    const left = (width - panelWidth) / 2;
    const top = (height - panelHeight) / 2;

    const backdrop = this.add
      .rectangle(0, 0, width, height, 0x04070a, 0.84)
      .setOrigin(0)
      .setInteractive({ useHandCursor: false });
    backdrop.on('pointerup', () => this.closeKnowYourEnemy());

    const panel = this.add.graphics();
    panel.fillStyle(0x0b131b, 0.98);
    panel.fillRoundedRect(left, top, panelWidth, panelHeight, 18);
    panel.lineStyle(1, 0x2b4457, 1);
    panel.strokeRoundedRect(left, top, panelWidth, panelHeight, 18);

    const title = this.add
      .text(width / 2, top + 38, 'KNOW YOUR ENEMY', {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#dffaff',
      })
      .setOrigin(0.5);
    title.setLetterSpacing(5);

    const close = this.add
      .text(width / 2, top + panelHeight - 32, 'CLOSE   ·   B', {
        fontFamily: FONT_MONO,
        fontSize: '13px',
        color: '#7d95a6',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#dffaff'));
    close.on('pointerout', () => close.setColor('#7d95a6'));
    close.on('pointerup', () => this.closeKnowYourEnemy());

    const layer = this.add.container(0, 0, [backdrop, panel, title, close]).setDepth(101);
    renderKnowYourEnemy(this, layer, { left, top, width: panelWidth, height: panelHeight, wave });
    this.knowYourEnemyLayer = layer;
  }

  private closeKnowYourEnemy(): void {
    if (!this.knowYourEnemyLayer) return;
    this.knowYourEnemyLayer.destroy(true);
    this.knowYourEnemyLayer = undefined;
    audio.play('click');
    // Resume unless the pause panel is what is sitting behind the table.
    if (!this.pauseLayer.visible) this.scene.resume('GameScene');
  }

  /** M: the music bus, which keeps its own gain, so it never touches the effects. */
  private toggleMusicKey(): void {
    audio.toggleMusicBus();
    this.refreshAudioWidgets();
  }

  /** N: every sound effect, the same switch the HUD SOUND button drives. */
  private toggleMute(): void {
    audio.toggleSoundBus();
    this.refreshAudioWidgets();
  }

  /** Both in-run switches show the audio state, so they repaint together after any change. */
  private refreshAudioWidgets(): void {
    this.soundButtonDraw?.(false);
    if (this.pauseLayer.visible) this.refreshPauseAudio();
  }
}
