// Codeflow adds no blocks: it adds an editor button that shows a game's
// code as pseudocode and flowcharts. This test checks the extension compiles
// alongside a typical Arcade program.
let hero = sprites.create(img`
    . 5 .
    5 5 5
    . 5 .
    `, SpriteKind.Player)
controller.moveSprite(hero)
controller.A.onEvent(ControllerButtonEvent.Pressed, function () {
    codeflow.describe("add a point")
    info.changeScoreBy(1)
})
