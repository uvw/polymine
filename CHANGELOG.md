# Changelog

## [0.2.0](https://github.com/uvw/polymine/compare/v0.1.1...v0.2.0) (2026-11-24)


### Features

* **cli:** switch a running instance's theme and ask it for its folders ([#41](https://github.com/uvw/polymine/issues/41)) ([b6a857e](https://github.com/uvw/polymine/commit/b6a857ee802d9295302fb30f5d4f718945d20639))
* **macos:** show the theme's icon in the dock ([#40](https://github.com/uvw/polymine/issues/40)) ([bb21340](https://github.com/uvw/polymine/commit/bb21340d7214602f655ed5686cb6a89f275c55d0))


### Bug fixes

* **app:** answer and recover when a command panics ([#39](https://github.com/uvw/polymine/issues/39)) ([0d31b1b](https://github.com/uvw/polymine/commit/0d31b1bfd11f24a898e1e3e09f143b7b58a13529))
* clear the open code scanning and dependabot findings ([#33](https://github.com/uvw/polymine/issues/33)) ([7dde91b](https://github.com/uvw/polymine/commit/7dde91b9dfcbedabc61412b60d14e98166c2deb1))
* **deps:** update cookie to 0.18.3 for RUSTSEC-2026-0594 ([#31](https://github.com/uvw/polymine/issues/31)) ([2b75eec](https://github.com/uvw/polymine/commit/2b75eecd03e44d02b12299ce9478c810a1dc8ea3))
* **macos:** keep the traffic lights still while the window resizes ([#35](https://github.com/uvw/polymine/issues/35)) ([9f7d8b0](https://github.com/uvw/polymine/commit/9f7d8b0d90c5b15d32534355d31cc2592e799da9))
* **themes:** refuse svg references outside the file ([#38](https://github.com/uvw/polymine/issues/38)) ([1a618d1](https://github.com/uvw/polymine/commit/1a618d185384f2a3a7edd403313d0a5808f9a1c5))
* **ui:** hit-test the board only for pointer moves that need it ([#30](https://github.com/uvw/polymine/issues/30)) ([ea93034](https://github.com/uvw/polymine/commit/ea9303488bab5e90dc8ee578222c444a677b39b2))
* **ui:** resize the board's canvas once a window resize settles ([#36](https://github.com/uvw/polymine/issues/36)) ([ddb6a31](https://github.com/uvw/polymine/commit/ddb6a3162edf95e60d2d6964d51c4ec301200ce0))
* **ui:** stop pixi's system ticker so an idle board draws no frames ([#29](https://github.com/uvw/polymine/issues/29)) ([f3f1c2b](https://github.com/uvw/polymine/commit/f3f1c2b4e26865222de39d72160713189be22a4f))
* **ui:** stop the pause animation once it has settled and while the window is away ([#34](https://github.com/uvw/polymine/issues/34)) ([2c919ed](https://github.com/uvw/polymine/commit/2c919edfd08c59ec1ae176d67ab2309caa0c01d1))

## [0.1.1](https://github.com/uvw/polymine/compare/v0.1.0...v0.1.1) (2026-11-23)

### Bug fixes

- **ui:** hide a pinned hint while the game is paused
  ([#24](https://github.com/uvw/polymine/issues/24))
  ([358b5b8](https://github.com/uvw/polymine/commit/358b5b8b458b4f0fb4724a7a6e8eb19b8410d140))
- **ui:** link the repository from the About dialog
  ([#27](https://github.com/uvw/polymine/issues/27))
  ([7909d80](https://github.com/uvw/polymine/commit/7909d806dc7a4629ad03b56b703bc1a7ea4a158c))

## [0.1.0](https://github.com/uvw/polymine/releases/tag/v0.1.0) (2026-11-23)

The first public release.

### Features

- Minesweeper on 18 tilings, from squares and hexagons to herringbone bricks,
  kites, pentagon florets, and snub squares, each rated for complexity.
- Beginner, Amateur, Professional, and Crazy levels, plus custom boards, and a
  first click that's never a mine.
- Flags, optional question marks, and smart click.
- An assistant that shows the next safe move or plays the whole game.
- Statistics and a champions table for each tiling and level.
- 31 built-in themes with a page of their own, and themes you make yourself as
  folders of CSS variables.
- A daily check for signed updates, which install when you choose to. Settings
  can turn the check off.
- `polymine-cli`, so scripts and coding agents can play from a terminal.
- On Windows, the taskbar shows the theme's icon, and a startup failure shows in
  a message box.
