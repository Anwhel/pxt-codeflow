namespace SpriteKind {
    export const Coin = SpriteKind.create()
}
controller.A.onEvent(ControllerButtonEvent.Pressed, function () {
    if (mySprite.isHittingTile(CollisionDirection.Bottom)) {
        mySprite.vy = -150
        music.baDing.play()
    }
})
sprites.onOverlap(SpriteKind.Player, SpriteKind.Coin, function (sprite, otherSprite) {
    otherSprite.destroy(effects.confetti, 200)
    info.changeScoreBy(1)
    if (info.score() >= 10) {
        game.over(true)
    }
})
scene.onOverlapTile(SpriteKind.Player, assets.tile`lava`, function (sprite, location) {
    info.changeLifeBy(-1)
    tiles.placeOnRandomTile(mySprite, assets.tile`start`)
})
info.onCountdownEnd(function () {
    game.over(false)
})
function spawnCoins (count: number) {
    for (let index = 0; index < count; index++) {
        coin = sprites.create(img`
            . 5 5 .
            5 5 5 5
            . 5 5 .
            `, SpriteKind.Coin)
        coin.setPosition(randint(10, 150), randint(10, 100))
    }
}
let coin: Sprite = null
let mySprite: Sprite = null
// Set up the level
scene.setBackgroundColor(9)
tiles.setCurrentTilemap(tilemap`level1`)
mySprite = sprites.create(assets.image`hero`, SpriteKind.Player)
controller.moveSprite(mySprite, 100, 0)
mySprite.ay = 300
scene.cameraFollowSprite(mySprite)
info.setLife(3)
info.startCountdown(60)
spawnCoins(5)
game.onUpdate(function () {
    if (mySprite.y > 200) {
        game.over(false)
    }
})
game.onUpdateInterval(2000, function () {
    projectile = sprites.createProjectileFromSide(img`
        2 2
        2 2
        `, -50, 0)
    projectile.y = randint(0, 120)
    timer.after(500, function () {
        projectile.sayText("Hi!", 500, false)
    })
})
