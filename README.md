# REDLINE — Wheel Racing

A 3D racing game that runs in your browser, built for the **Logitech G29 / G920 Driving Force** wheel, pedals and the **Driving Force Shifter** (H-pattern). Keyboard and Xbox/PlayStation controllers work too.

- **Real H-pattern shifting**: shifter in gear = in gear, middle = neutral. Optional manual clutch: grind the gears if you don't clutch, stall if you dump it at idle.
- **Force feedback + rev lights** straight to the wheel (via WebHID): tyre self-aligning torque that goes light when you understeer, kerb rumble, grass, impacts and a soft lock at the car's steering limit. The G29's LED bar works as shift lights.
- **Cockpit view** with a steering wheel that turns 1:1 with yours, rev LEDs and a gear/speed display. Bonnet and chase cams too.
- **3 tracks**: *Coastline GP* (midday, ocean and mountains), *Pinewood Ring* (hilly forest at golden hour), *Midnight Circuit* (night street circuit).
- **3 cars**: *Vortex GT* (balanced V8), *Raptor R* (light, high-revving, winged), *Titan V12* (620 hp, handle with care).
- **Race** up to 9 AI drivers, or **Time Trial** against a ghost of your best lap.
- Engine, tyre and backfire sounds are synthesised live. No downloads needed.

## Play it

1. Download **`index.html`** from this repo (open the file on GitHub → *Download raw file*).
2. Open it in **Google Chrome** or **Microsoft Edge** (double-click works, no install or internet needed).
   Firefox can play with the wheel but can't do force feedback or rev lights.

## Setting up the G29 / G920

1. Plug in the wheel and pedals. Plug the **Driving Force Shifter** into the back of the wheel base.
   - G29: set the switch on the wheel to **PS3** mode for PC.
2. In **Logitech G HUB**: set the operating range to **900°** and turn **off** "Centering Spring in non-force feedback games" (the game makes its own centering).
3. Open the game and **press any button on the wheel** (browsers only show controllers after a button press).
4. The main menu will say *Wheel detected*. Click **Set up wheel** and follow the prompts (about 30 seconds):
   turn the wheel left/right/center, press each pedal, click through gears 1-6 and R, then pick your paddle and button choices (any step can be skipped).
5. **Force feedback**: *Settings → Connect wheel for force feedback* and pick your wheel in the browser popup.
   Press *Test*: the wheel should turn **right then left**. If it goes the other way, turn on *Invert FFB direction*.
   After the first time, the game reconnects to the wheel automatically.

Once set up you can drive the menus with the wheel: **paddles** move up/down, **turning** changes an option, **gas** selects, **brake** goes back.

### Driving tips

- **Transmission**: *H-Shifter* (default when a shifter is set up), *Sequential* (paddles) or *Automatic*. Change it in Race setup or Settings.
- **Auto clutch** is on by default, so you can shift without the clutch pedal. Turn it off in Settings for the full manual experience.
- **Steering ratio** (Settings): lower = quicker steering. *Wheel rotation* must match what G HUB is set to (900° by default).
- Assists: ABS, traction control (on by default) and stability assist (for keyboard players).

## Controls

| Action | Wheel | Keyboard | Controller |
|---|---|---|---|
| Steer | wheel | A/D or ←/→ | left stick |
| Gas / brake | pedals | W/S or ↑/↓ | RT / LT |
| Clutch | clutch pedal | X | — |
| Shift | H-shifter / paddles | E / Q | RB / LB |
| Camera | (button you chose) | C | Y |
| Look back | (button you chose) | B (hold) | X |
| Reset car | (button you chose) | R | View |
| Pause | (button you chose) | Esc / P | Menu |
| Handbrake | (button you chose) | Space | B |

In **Automatic**, hold the brake at a standstill to engage reverse.

## Troubleshooting

- **Wheel not detected**: press a button on it, and use Chrome/Edge. The *Raw input monitor* at the bottom of the setup wizard shows exactly what the browser sees.
- **Pedals or steering wrong / reversed**: run *Wheel Setup* again (main menu or Settings).
- **No force feedback**: click *Connect wheel for force feedback* in Settings and choose the wheel. If the popup is empty, close other apps that might be holding the wheel and reload. Force feedback is experimental; the game is fully playable without it.
- **Low frame rate**: Settings → Graphics → Low. Add `?fps` to the URL to show an FPS counter.

## Development

```bash
npm install
npm test            # physics + track checks (Node, no browser needed)
npm run build       # bundles src/ + three.js into the single-file index.html
npx serve .         # then open http://localhost:3000/src/index.html for the unbundled dev version
```

Source layout (`src/`):

| File | What it does |
|---|---|
| `physics.js` | Vehicle dynamics: tyre model, load transfer, engine/clutch/gearbox, assists, steering torque for FFB |
| `cars.js` | Car specs (mass, torque curves, gearing, grip) |
| `track.js` | Track layouts, spline sampling, racing line, AI speed profiles, terrain height |
| `world.js` | Builds the 3D scene: terrain, road, kerbs, walls, trees, grandstands, start lights, city, ocean |
| `carModel.js` | Procedural car meshes and the cockpit |
| `game.js` | Race session: laps, positions, collisions, cameras, FFB mix, ghost car |
| `ai.js` | AI drivers |
| `input.js` / `wizard.js` | Wheel/pedal/shifter mapping and the setup wizard |
| `ffb.js` | WebHID force feedback + rev LEDs (G29 classic protocol, G920 HID++) |
| `audio.js` | Procedural engine and effects audio |
| `hud.js` / `ui.js` / `showroom.js` | HUD, menus and the menu background |
