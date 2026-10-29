// Whether this computer runs on its battery (Chromium's Battery Status API; a desktop reports itself charging), for
// "Pause reading on battery".

export class Power {
  onBattery = false;
  private stop: (() => void) | null = null;

  constructor(changed: () => void) {
    const nav = navigator as Navigator & { getBattery?: () => Promise<EventTarget & { charging: boolean }> };
    void nav.getBattery?.().then((battery) => {
      const update = () => {
        const now = !battery.charging;
        if (now !== this.onBattery) { this.onBattery = now; changed(); }
      };
      battery.addEventListener("chargingchange", update);
      this.stop = () => battery.removeEventListener("chargingchange", update);
      update();
    }).catch(() => {});
  }

  close(): void {
    this.stop?.();
  }
}
