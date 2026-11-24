let total = 0
let list = [1, 2, 3]
for (let i = 1; i <= 5; i++) {
    total += i
    if (i == 3) {
        continue
    } else if (i > 4) {
        break
    } else {
        total -= 1
    }
}
for (let value of list) {
    console.log(value)
}
while (total > 0) {
    total = total - 2
}
let name = game.askForString("Your name?")
game.splash("Hello " + name)
let level = 2
switch (level) {
    case 1:
        game.splash("Easy")
        break
    case 2:
        game.splash("Hard")
        break
    default:
        game.splash("??")
}
function double (n: number) {
    return n * 2
}
forever(function () {
    pause(100)
    total = double(total)
})
