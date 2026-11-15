import Phaser from 'phaser';

/**
 * Generates every texture procedurally with Graphics, so the game ships with no
 * binary art assets and no licensing to worry about. Swapping in sprites later
 * only means registering the keys used here.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.createPlayerTexture();
    this.createBulletTextures();
    this.createEnemyTextures();
    this.createPickupTextures();
    this.createFloorTexture();
    this.createEffectTextures();

    this.scene.start('MenuScene');
  }

  private makeTexture(
    key: string,
    width: number,
    height: number,
    draw: (graphics: Phaser.GameObjects.Graphics) => void,
  ): void {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    draw(graphics);
    graphics.generateTexture(key, width, height);
    graphics.destroy();
  }

  private createPlayerTexture(): void {
    this.makeTexture('player', 44, 44, (g) => {
      // Barrel points right so sprite rotation can follow the aim angle.
      g.fillStyle(0x2a4a5c, 1);
      g.fillRoundedRect(19, 17, 24, 10, 4);
      g.fillStyle(0xdff7ff, 1);
      g.fillRoundedRect(20, 18.5, 21, 7, 3);
      g.fillStyle(0x6ee7ff, 1);
      g.fillCircle(22, 22, 14);
      g.lineStyle(3, 0x123846, 1);
      g.strokeCircle(22, 22, 14);
      g.fillStyle(0x0d2735, 1);
      g.fillCircle(22, 22, 6.5);
      g.fillStyle(0xaef4ff, 1);
      g.fillCircle(18.5, 17.5, 3);
    });
  }

  private createBulletTextures(): void {
    this.makeTexture('bullet', 12, 12, (g) => {
      g.fillStyle(0xfff3a0, 0.28);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0xffe066, 1);
      g.fillCircle(6, 6, 3.6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(5.2, 5.2, 1.5);
    });

    this.makeTexture('enemy-bullet', 12, 12, (g) => {
      g.fillStyle(0xff5e9e, 0.3);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0xff3d7f, 1);
      g.fillCircle(6, 6, 3.8);
      g.fillStyle(0xffd6e5, 1);
      g.fillCircle(5.2, 5.2, 1.4);
    });

    // Shocker jolt: a spiked white-hot star instead of a round bolt, so a hit that will take the
    // gun away is recognisable mid-flight.
    this.makeTexture('enemy-bullet-shock', 16, 16, (g) => {
      const cx = 8;
      const cy = 8;
      g.fillStyle(0xffe14d, 0.26);
      g.fillCircle(cx, cy, 8);
      g.fillStyle(0xffe14d, 1);
      g.beginPath();
      g.moveTo(cx, 0);
      g.lineTo(cx + 3, cy - 3);
      g.lineTo(16, cy);
      g.lineTo(cx + 3, cy + 3);
      g.lineTo(cx, 16);
      g.lineTo(cx - 3, cy + 3);
      g.lineTo(0, cy);
      g.lineTo(cx - 3, cy - 3);
      g.closePath();
      g.fillPath();
      g.fillStyle(0xfffbe0, 1);
      g.fillCircle(cx, cy, 2.6);
    });
  }

  private createEnemyTextures(): void {
    this.makeTexture('enemy-chaser', 26, 26, (g) => {
      g.fillStyle(0xff5e6b, 1);
      g.fillCircle(13, 13, 10.5);
      g.lineStyle(2.5, 0x4d1219, 1);
      g.strokeCircle(13, 13, 10.5);
      g.fillStyle(0x30060a, 1);
      g.fillCircle(13, 13, 4);
      g.fillStyle(0xffb3ba, 1);
      g.fillCircle(9.5, 9.5, 2);
    });

    this.makeTexture('enemy-runner', 20, 20, (g) => {
      g.fillStyle(0xffa14a, 1);
      g.beginPath();
      g.moveTo(18, 10);
      g.lineTo(10, 18);
      g.lineTo(2, 10);
      g.lineTo(10, 2);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, 0x532504, 1);
      g.strokePath();
      g.fillStyle(0xffe3bd, 1);
      g.fillCircle(10, 10, 2.4);
    });

    this.makeTexture('enemy-tank', 40, 40, (g) => {
      g.fillStyle(0x9d7bf5, 1);
      g.fillRoundedRect(5, 5, 30, 30, 9);
      g.lineStyle(3, 0x2d1b4d, 1);
      g.strokeRoundedRect(5, 5, 30, 30, 9);
      g.fillStyle(0x42266e, 1);
      g.fillRoundedRect(12, 12, 16, 16, 5);
      g.fillStyle(0xd7c8ff, 1);
      g.fillRect(16, 16, 3, 3);
      g.fillRect(22, 22, 3, 3);
    });

    this.makeTexture('enemy-shooter', 30, 30, (g) => {
      g.fillStyle(0x4fd1c5, 1);
      g.fillCircle(15, 15, 12);
      g.lineStyle(2.5, 0x0d3f43, 1);
      g.strokeCircle(15, 15, 12);
      g.fillStyle(0x0b2b2f, 1);
      g.fillCircle(15, 15, 6.5);
      g.fillStyle(0xd5fffb, 1);
      g.fillCircle(15, 15, 2.6);
      g.fillStyle(0x4fd1c5, 1);
      g.fillRect(15, 13, 12, 4);
    });

    // Shocker: a hex plate with a lightning bolt cut into it, yellow against the shooter's teal
    // circle so the ranged pair never look alike at a glance.
    this.makeTexture('enemy-shocker', 34, 34, (g) => {
      const cx = 17;
      const cy = 17;
      g.lineStyle(2, 0xffe14d, 0.4);
      g.strokeCircle(cx, cy, 16);
      g.fillStyle(0x2c2a17, 1);
      g.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const x = cx + Math.cos(angle) * 13;
        const y = cy + Math.sin(angle) * 13;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillPath();
      g.lineStyle(2, 0x6b6224, 1);
      g.strokeCircle(cx, cy, 13);
      g.fillStyle(0xffe14d, 1);
      g.beginPath();
      g.moveTo(cx + 3, cy - 11);
      g.lineTo(cx - 5, cy + 1);
      g.lineTo(cx, cy + 1);
      g.lineTo(cx - 3, cy + 11);
      g.lineTo(cx + 5, cy - 1);
      g.lineTo(cx, cy - 1);
      g.closePath();
      g.fillPath();
      g.fillStyle(0x2c2a17, 1);
      g.fillCircle(cx - 9, cy - 6, 1.5);
      g.fillCircle(cx + 9, cy + 6, 1.5);
    });

    // Bomber: spiked charge with a white-hot core, so it reads as "do not hug this".
    this.makeTexture('enemy-bomber', 32, 32, (g) => {
      const spikes = 10;
      const cx = 16;
      const cy = 16;
      g.fillStyle(0x5a1a12, 1);
      g.beginPath();
      for (let i = 0; i < spikes * 2; i += 1) {
        const angle = (Math.PI * i) / spikes;
        const radius = i % 2 === 0 ? 15 : 11;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillPath();
      g.fillStyle(0xff7a3d, 1);
      g.fillCircle(cx, cy, 9.5);
      g.lineStyle(2, 0x2b0703, 1);
      g.strokeCircle(cx, cy, 9.5);
      g.fillStyle(0xfff1cc, 1);
      g.fillCircle(cx, cy, 4.5);
      g.fillStyle(0x2b0703, 1);
      g.fillCircle(cx, cy - 6.5, 1.4);
      g.fillCircle(cx, cy + 6.5, 1.4);
      g.fillCircle(cx - 6.5, cy, 1.4);
      g.fillCircle(cx + 6.5, cy, 1.4);
    });

    // Healer: mint support unit, square body with a cross and a faint aura ring.
    this.makeTexture('enemy-healer', 36, 36, (g) => {
      const cx = 18;
      const cy = 18;
      g.lineStyle(2, 0x5ee6a8, 0.4);
      g.strokeCircle(cx, cy, 16.5);
      g.fillStyle(0x1d6b4f, 1);
      g.fillRoundedRect(6, 6, 24, 24, 8);
      g.lineStyle(2.5, 0x082a1e, 1);
      g.strokeRoundedRect(6, 6, 24, 24, 8);
      g.fillStyle(0x9dffd4, 1);
      g.fillRoundedRect(15.5, 10, 5, 16, 2);
      g.fillRoundedRect(10, 15.5, 16, 5, 2);
    });

    // Teleporter: a violet diamond inside a portal halo, so a blink reads before it happens.
    this.makeTexture('enemy-teleporter', 34, 34, (g) => {
      const cx = 17;
      const cy = 17;
      g.lineStyle(2, 0xb18cff, 0.45);
      g.strokeCircle(cx, cy, 15.5);
      g.fillStyle(0x3b1d6e, 1);
      g.beginPath();
      g.moveTo(cx, 3);
      g.lineTo(cx + 13, cy);
      g.lineTo(cx, cy + 14);
      g.lineTo(cx - 13, cy);
      g.closePath();
      g.fillPath();
      g.fillStyle(0x8b5cf6, 1);
      g.fillCircle(cx, cy, 8);
      g.fillStyle(0xe9dcff, 1);
      g.fillCircle(cx, cy, 4);
      g.fillStyle(0x140a2b, 1);
      g.fillCircle(cx, cy, 1.6);
    });

    // Cloner: a bright square core with three solid satellites pinned to a ring around it. Nothing
    // else on the field has satellites, so the silhouette says "one makes copies" on its own at
    // 40 px, and the pale cyan survives the wash a clone gets. The faint outer halo is the radius it
    // drops them in. Filled shapes only — a card deck read as mush at this size.
    this.makeTexture('enemy-cloner', 40, 40, (g) => {
      const cx = 20;
      const cy = 20;
      const orbit = 13.5;

      // Halo: the pulse its copies come out of.
      g.lineStyle(2, 0x8fe6ff, 0.3);
      g.strokeCircle(cx, cy, 17);

      // Orbit line, so the three pips read as one object instead of loose dots.
      g.lineStyle(1.5, 0x8fe6ff, 0.5);
      g.strokeCircle(cx, cy, orbit);

      // Satellites: the copies. Dark outline first, so they stay separate from the core plate.
      for (let i = 0; i < 3; i += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 3;
        const x = cx + Math.cos(angle) * orbit;
        const y = cy + Math.sin(angle) * orbit;
        g.fillStyle(0x0c2838, 1);
        g.fillCircle(x, y, 4.4);
        g.fillStyle(0xaef4ff, 1);
        g.fillCircle(x, y, 3);
      }

      // Core: the original. Navy plate, cyan edge, bright seed in the middle.
      g.fillStyle(0x0c2838, 1);
      g.fillRoundedRect(cx - 8, cy - 8, 16, 16, 5);
      g.lineStyle(2.4, 0x8fe6ff, 1);
      g.strokeRoundedRect(cx - 8, cy - 8, 16, 16, 5);
      g.fillStyle(0xd8f6ff, 1);
      g.fillRoundedRect(cx - 3.5, cy - 3.5, 7, 7, 2.5);
    });

    this.makeTexture('enemy-boss', 76, 76, (g) => {
      const spikes = 8;
      const cx = 38;
      const cy = 38;
      g.fillStyle(0x8f1834, 1);
      g.beginPath();
      for (let i = 0; i < spikes * 2; i += 1) {
        const angle = (Math.PI * i) / spikes;
        const radius = i % 2 === 0 ? 36 : 27;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillPath();
      g.fillStyle(0xff3d6b, 1);
      g.fillCircle(cx, cy, 22);
      g.lineStyle(3, 0x2a0512, 1);
      g.strokeCircle(cx, cy, 22);
      g.fillStyle(0x2a0512, 1);
      g.fillCircle(cx, cy, 11);
      g.fillStyle(0xffd9e2, 1);
      g.fillCircle(cx, cy, 4.5);
    });
  }

  private createPickupTextures(): void {
    this.makeTexture('pickup-health', 24, 24, (g) => {
      g.fillStyle(0x4ade80, 1);
      g.fillCircle(12, 12, 10.5);
      g.lineStyle(2, 0x0f3d24, 1);
      g.strokeCircle(12, 12, 10.5);
      g.fillStyle(0xf2fff7, 1);
      g.fillRoundedRect(10, 5.5, 4, 13, 1.5);
      g.fillRoundedRect(5.5, 10, 13, 4, 1.5);
    });

    this.makeTexture('pickup-weapon', 24, 24, (g) => {
      g.fillStyle(0x5ce1ff, 1);
      g.fillCircle(12, 12, 10.5);
      g.lineStyle(2, 0x073444, 1);
      g.strokeCircle(12, 12, 10.5);
      g.fillStyle(0xf0fdff, 1);
      g.fillRect(6.5, 9.5, 8, 3);
      g.fillRect(12, 10.5, 3.5, 6);
      g.fillRect(8, 12.5, 2.5, 4);
    });

    this.makeTexture('pickup-multiplier', 24, 24, (g) => {
      g.fillStyle(0xffd166, 1);
      g.fillCircle(12, 12, 10.5);
      g.lineStyle(2, 0x4a3405, 1);
      g.strokeCircle(12, 12, 10.5);
      g.fillStyle(0xfffbe8, 1);
      g.beginPath();
      g.moveTo(12, 5);
      g.lineTo(14.3, 10);
      g.lineTo(19.5, 10.6);
      g.lineTo(15.6, 14.2);
      g.lineTo(16.7, 19.4);
      g.lineTo(12, 16.7);
      g.lineTo(7.3, 19.4);
      g.lineTo(8.4, 14.2);
      g.lineTo(4.5, 10.6);
      g.lineTo(9.7, 10);
      g.closePath();
      g.fillPath();
    });

    // Damage overdrive: upward arrow on a hot orange disc.
    this.makeTexture('pickup-damage', 24, 24, (g) => {
      g.fillStyle(0xff9f6b, 1);
      g.fillCircle(12, 12, 10.5);
      g.lineStyle(2, 0x5a2107, 1);
      g.strokeCircle(12, 12, 10.5);
      g.fillStyle(0xfff4ec, 1);
      g.beginPath();
      g.moveTo(12, 5);
      g.lineTo(18, 11.6);
      g.lineTo(14.6, 11.6);
      g.lineTo(14.6, 17.4);
      g.lineTo(9.4, 17.4);
      g.lineTo(9.4, 11.6);
      g.lineTo(6, 11.6);
      g.closePath();
      g.fillPath();
    });

    // Permanent max-health gain: heart on a rose disc.
    this.makeTexture('pickup-vitality', 24, 24, (g) => {
      g.fillStyle(0xff7ac6, 1);
      g.fillCircle(12, 12, 10.5);
      g.lineStyle(2, 0x4a0f2f, 1);
      g.strokeCircle(12, 12, 10.5);
      g.fillStyle(0xfff0f8, 1);
      g.fillCircle(9.3, 10, 3.4);
      g.fillCircle(14.7, 10, 3.4);
      g.beginPath();
      g.moveTo(5.9, 10.9);
      g.lineTo(18.1, 10.9);
      g.lineTo(12, 18.6);
      g.closePath();
      g.fillPath();
    });

    // Invulnerability shield: shield outline on a cool blue disc.
    this.makeTexture('pickup-shield', 24, 24, (g) => {
      g.fillStyle(0x8ab4ff, 1);
      g.fillCircle(12, 12, 10.5);
      g.lineStyle(2, 0x10254a, 1);
      g.strokeCircle(12, 12, 10.5);
      g.beginPath();
      g.moveTo(12, 4.6);
      g.lineTo(18.4, 7.1);
      g.lineTo(18.4, 11.8);
      g.lineTo(12, 19.2);
      g.lineTo(5.6, 11.8);
      g.lineTo(5.6, 7.1);
      g.closePath();
      g.fillStyle(0xf2f7ff, 1);
      g.fillPath();
      g.lineStyle(1.6, 0x24406e, 1);
      g.strokePath();
    });

    // Battle buddy: two small figures on a pale lavender disc, so the drop reads as "an ally".
    this.makeTexture('pickup-buddy', 24, 24, (g) => {
      g.fillStyle(0xd9cfff, 1);
      g.fillCircle(12, 12, 10.5);
      g.lineStyle(2, 0x2c2145, 1);
      g.strokeCircle(12, 12, 10.5);
      g.fillStyle(0xfaf6ff, 1);
      g.fillCircle(9.4, 8.9, 2.7);
      g.fillCircle(15.2, 10.1, 2.2);
      g.fillRoundedRect(6.1, 11.6, 6.6, 6.6, 2.6);
      g.fillRoundedRect(12.4, 12.9, 5.2, 5.2, 2.2);
    });

    // Thrown bomb: dark iron ball, amber rim and a lit fuse.
    this.makeTexture('bomb', 26, 26, (g) => {
      g.lineStyle(2, 0xffd166, 1);
      g.beginPath();
      g.moveTo(13, 7);
      g.lineTo(16.5, 2.5);
      g.strokePath();
      g.fillStyle(0xfff0b0, 1);
      g.fillCircle(17, 2.5, 2);
      g.fillStyle(0x1b2a36, 1);
      g.fillCircle(13, 15, 10);
      g.fillStyle(0x334c60, 1);
      g.fillCircle(9.6, 12, 3.4);
      g.lineStyle(2, 0xffd166, 1);
      g.strokeCircle(13, 15, 10);
      g.fillStyle(0x0a1016, 1);
      g.fillRect(10.5, 4.2, 5, 5);
    });
  }

  private createFloorTexture(): void {
    this.makeTexture('floor', 96, 96, (g) => {
      g.fillStyle(0x0f1720, 1);
      g.fillRect(0, 0, 96, 96);
      g.lineStyle(1, 0x1a2733, 0.85);
      g.strokeRect(0.5, 0.5, 95, 95);
      g.lineStyle(1, 0x141f29, 0.9);
      g.beginPath();
      g.moveTo(48, 0);
      g.lineTo(48, 96);
      g.moveTo(0, 48);
      g.lineTo(96, 48);
      g.strokePath();
      g.fillStyle(0x233441, 0.75);
      g.fillRect(46, 46, 4, 4);
    });
  }

  private createEffectTextures(): void {
    this.makeTexture('particle', 6, 6, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 6, 6);
    });

    this.makeTexture('ring', 72, 72, (g) => {
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeCircle(36, 36, 32);
      g.lineStyle(1, 0xffffff, 0.35);
      g.strokeCircle(36, 36, 24);
    });
  }
}
