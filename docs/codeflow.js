/*
 * Codeflow core: turns MakeCode Arcade JavaScript into plain-English
 * pseudocode and Mermaid flowcharts.
 *
 *   Codeflow.analyse(sourceText, ts) -> { sections, warnings }
 *
 * `ts` is the TypeScript compiler module (window.ts in the browser,
 * require('typescript') in Node). Each section is one entry point of the
 * game (on start, an event handler, or a function) and has:
 *   { id, kind, title, lines: [{ depth, text, nodeId }], mermaid }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Codeflow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let ts; // TypeScript module, set by analyse()

  // ---------------------------------------------------------------------
  // Small text helpers
  // ---------------------------------------------------------------------

  /** "setBackgroundColor" -> "set background color" */
  function words(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase();
  }

  /** "StayInScreen" -> "Stay In Screen" (keeps capitals, for enum values) */
  function titleWords(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/_/g, ' ');
  }

  function capFirst(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function article(word) {
    return /^[aeiou]/i.test(String(word).trim()) ? 'an' : 'a';
  }

  /** "a Player" / "an Enemy" */
  function aKind(kind) { return article(kind) + ' ' + kind; }

  /** Negate a rendered number-ish value: "5" -> "-5", "-5" -> "5", "x" -> "-(x)" */
  function negate(text) {
    if (/^-?\d+(\.\d+)?$/.test(text)) return text[0] === '-' ? text.slice(1) : '-' + text;
    if (/^[\w.']+$/.test(text)) return '-' + text;
    return '-(' + text + ')';
  }

  // ---------------------------------------------------------------------
  // Knowledge about MakeCode Arcade APIs
  // ---------------------------------------------------------------------

  /** Friendly names for common sprite properties. */
  const PROPS = {
    vx: 'x velocity', vy: 'y velocity',
    ax: 'x acceleration', ay: 'y acceleration',
    fx: 'x friction', fy: 'y friction',
    z: 'z (layer)', lifespan: 'lifespan', image: 'image',
    left: 'left edge', right: 'right edge', top: 'top edge', bottom: 'bottom edge',
    sx: 'x scale', sy: 'y scale', scale: 'scale',
  };

  const BUTTONS = {
    A: 'A', B: 'B', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    menu: 'Menu', anyButton: 'Any',
  };

  const BUTTON_EVENTS = { Pressed: 'Pressed', Released: 'Released', Repeated: 'Held Down (repeating)' };

  /*
   * Call phrasebook. Keys are either the full callee ("info.changeScoreBy")
   * or ".method" which matches any receiver (sprites, lists...).
   * s(args, obj) -> statement text   e(args, obj) -> expression text
   * io: true marks input/output (drawn as a parallelogram in flowcharts).
   */
  const CALLS = {
    // --- sprites ---
    'sprites.create': { e: a => `a new ${a[1] || ''} sprite`.replace('  ', ' '), s: a => `CREATE a new ${a[1]} sprite` },
    'sprites.createProjectileFromSprite': {
      e: a => `a new projectile from ${a[1]} moving at vx ${a[2]}, vy ${a[3]}`,
      s: a => `SHOOT a projectile from ${a[1]} moving at vx ${a[2]}, vy ${a[3]}`,
    },
    'sprites.createProjectileFromSide': {
      e: a => `a new projectile from the side of the screen moving at vx ${a[1]}, vy ${a[2]}`,
      s: a => `SHOOT a projectile from the side of the screen moving at vx ${a[1]}, vy ${a[2]}`,
    },
    'sprites.createProjectile': {
      e: a => `a new projectile moving at vx ${a[1]}, vy ${a[2]}`,
      s: a => `SHOOT a projectile moving at vx ${a[1]}, vy ${a[2]}`,
    },
    'sprites.destroyAllSpritesOfKind': { s: a => `DESTROY all ${a[0]} sprites` },
    'sprites.allOfKind': { e: a => `the list of all ${a[0]} sprites` },
    'sprites.readDataNumber': { e: a => `the number "${unq(a[1])}" stored on ${a[0]}` },
    'sprites.setDataNumber': { s: a => `SET the number "${unq(a[1])}" on ${a[0]} TO ${a[2]}` },
    'sprites.changeDataNumberBy': { s: a => `CHANGE the number "${unq(a[1])}" on ${a[0]} BY ${a[2]}` },
    'sprites.readDataString': { e: a => `the text "${unq(a[1])}" stored on ${a[0]}` },
    'sprites.setDataString': { s: a => `SET the text "${unq(a[1])}" on ${a[0]} TO ${a[2]}` },
    'sprites.readDataBoolean': { e: a => `the flag "${unq(a[1])}" stored on ${a[0]}` },
    'sprites.setDataBoolean': { s: a => `SET the flag "${unq(a[1])}" on ${a[0]} TO ${a[2]}` },
    'sprites.readDataSprite': { e: a => `the sprite "${unq(a[1])}" stored on ${a[0]}` },
    'sprites.setDataSprite': { s: a => `SET the sprite "${unq(a[1])}" on ${a[0]} TO ${a[2]}` },
    '.setPosition': { s: (a, o) => `SET ${o}'s position TO x ${a[0]}, y ${a[1]}` },
    '.setVelocity': { s: (a, o) => `SET ${o}'s velocity TO vx ${a[0]}, vy ${a[1]}` },
    '.setImage': { s: (a, o) => `SET ${o}'s image TO ${a[0]}` },
    '.setKind': { s: (a, o) => `SET ${o}'s kind TO ${a[0]}` },
    '.kind': { e: (a, o) => `${o}'s kind` },
    '.setFlag': { s: (a, o) => `SET ${o}'s "${a[0]}" setting TO ${onOff(a[1])}` },
    '.setStayInScreen': { s: (a, o) => `SET ${o} to stay in the screen: ${onOff(a[0])}` },
    '.setBounceOnWall': { s: (a, o) => `SET ${o} to bounce on walls: ${onOff(a[0])}` },
    '.setScale': { s: (a, o) => `SET ${o}'s scale TO ${a[0]}` },
    '.changeScale': { s: (a, o) => `CHANGE ${o}'s scale BY ${a[0]}` },
    '.say': { io: true, s: (a, o) => `${o} SAYS ${a[0]}` + (a[1] ? ` for ${a[1]} ms` : '') },
    '.sayText': { io: true, s: (a, o) => `${o} SAYS ${a[0]}` + (a[1] ? ` for ${a[1]} ms` : '') },
    '.destroy': { s: (a, o) => `DESTROY ${o}` + (a[0] ? ` with the ${a[0]} effect` : '') + (a[1] ? ` for ${a[1]} ms` : '') },
    '.startEffect': { s: (a, o) => `START the ${a[0]} effect on ${o}` + (a[1] ? ` for ${a[1]} ms` : '') },
    '.follow': { s: (a, o) => `MAKE ${o} follow ${a[0]}` + (a[1] ? ` at speed ${a[1]}` : '') },
    '.overlapsWith': { e: (a, o) => `${o} is touching ${a[0]}` },
    '.isHittingTile': { e: (a, o) => `${o} is hitting a wall on the ${a[0]}` },
    '.tileKindAt': { e: (a, o) => `the tile ${a[0]} of ${o} is ${a[1]}` },
    '.tilemapLocation': { e: (a, o) => `${o}'s tile location` },
    '.isOutOfScreen': { e: (a, o) => `${o} is off the screen` },
    // --- controller ---
    'controller.moveSprite': {
      s: a => `LET the player move ${a[0]} with the arrow keys` + (a[1] ? ` (speed vx ${a[1]}, vy ${a[2] || a[1]})` : ''),
    },
    '.moveSprite': { s: (a, o) => `LET ${o} move ${a[0]} with the arrow keys` + (a[1] ? ` (speed vx ${a[1]}, vy ${a[2] || a[1]})` : '') },
    '.isPressed': { e: (a, o) => `${o} is pressed` },
    'controller.dx': { e: () => `the left/right controller movement` },
    'controller.dy': { e: () => `the up/down controller movement` },
    // --- scene & tiles ---
    'scene.setBackgroundColor': { s: a => `SET the background colour TO ${a[0]}` },
    'scene.setBackgroundImage': { s: a => `SET the background image TO ${a[0]}` },
    'scene.cameraFollowSprite': { s: a => `MAKE the camera follow ${a[0]}` },
    'scene.centerCameraAt': { s: a => `CENTRE the camera at x ${a[0]}, y ${a[1]}` },
    'scene.cameraShake': { s: a => `SHAKE the camera` + (a[0] ? ` (strength ${a[0]})` : '') + (a[1] ? ` for ${a[1]} ms` : '') },
    'scene.screenWidth': { e: () => `the screen width` },
    'scene.screenHeight': { e: () => `the screen height` },
    'tiles.setCurrentTilemap': { s: a => `SET the level TO ${a[0]}` },
    'tiles.setTilemap': { s: a => `SET the level TO ${a[0]}` },
    'scene.setTileMapLevel': { s: a => `SET the level TO ${a[0]}` },
    'tiles.placeOnTile': { s: a => `PLACE ${a[0]} on ${a[1]}` },
    'tiles.placeOnRandomTile': { s: a => `PLACE ${a[0]} on a random ${a[1].replace(/^the /, '')}` },
    'tiles.setTileAt': { s: a => `SET the tile at ${a[0]} TO ${a[1]}` },
    'tiles.setWallAt': { s: a => `SET a wall at ${a[0]}: ${onOff(a[1])}` },
    'tiles.getTileLocation': { e: a => `the tile at column ${a[0]}, row ${a[1]}` },
    'tiles.getTilesByType': { e: a => `the list of every ${a[0]}` },
    'tiles.tileAtLocationEquals': { e: a => `the tile at ${a[0]} is ${a[1]}` },
    'tiles.tileAtLocationIsWall': { e: a => `there is a wall at ${a[0]}` },
    'tiles.tileIs': { e: a => `the tile at ${a[0]} is ${a[1]}` },
    // --- info (score / life / countdown) ---
    'info.setScore': { s: a => `SET the score TO ${a[0]}` },
    'info.changeScoreBy': { s: a => `CHANGE the score BY ${a[0]}` },
    'info.score': { e: () => `the score` },
    'info.highScore': { e: () => `the high score` },
    'info.setLife': { s: a => `SET lives TO ${a[0]}` },
    'info.changeLifeBy': { s: a => `CHANGE lives BY ${a[0]}` },
    'info.life': { e: () => `the number of lives` },
    'info.startCountdown': { s: a => `START a countdown of ${a[0]} seconds` },
    'info.stopCountdown': { s: () => `STOP the countdown` },
    'info.countdown': { e: () => `the time left on the countdown` },
    // --- game ---
    'game.over': { s: a => a[0] === 'true' ? `GAME OVER (the player WINS)` : `GAME OVER` + (a[0] === 'false' ? ' (the player LOSES)' : '') },
    'game.gameOver': { s: a => a[0] === 'true' ? `GAME OVER (the player WINS)` : `GAME OVER (the player LOSES)` },
    'game.reset': { s: () => `RESTART the game` },
    'game.splash': { io: true, s: a => `SHOW the message ${a.join(' then ')}` },
    'game.showLongText': { io: true, s: a => `SHOW the text ${a[0]}` },
    'game.askForNumber': { io: true, e: a => `the number the player types in (asked: ${a[0]})` },
    'game.askForString': { io: true, e: a => `the text the player types in (asked: ${a[0]})` },
    'game.ask': { io: true, e: a => `the player's answer (A = yes) to ${a.join(' ')}` },
    'game.runtime': { e: () => `the time since the game started (ms)` },
    'game.setDialogFrame': { s: a => `SET the dialog frame TO ${a[0]}` },
    'pause': { s: a => `WAIT ${a[0]} ms` },
    'loops.pause': { s: a => `WAIT ${a[0]} ms` },
    'console.log': { io: true, s: a => `PRINT ${a[0]} to the console` },
    'console.logValue': { io: true, s: a => `PRINT ${a[0]} = ${a[1]} to the console` },
    // --- music & effects ---
    'music.play': { s: a => `PLAY ${a[0]}` + (a[1] ? ` (${a[1]})` : '') },
    'music.playMelody': { s: a => `PLAY the melody ${a[0]}` + (a[1] ? ` at tempo ${a[1]}` : '') },
    'music.playTone': { s: a => `PLAY the note ${a[0]} for ${a[1]}` },
    'music.stopAllSounds': { s: () => `STOP all sounds` },
    'music.setVolume': { s: a => `SET the volume TO ${a[0]}` },
    'music.melodyPlayable': { e: a => `the sound ${a[0]}` },
    'music.stringPlayable': { e: a => `the melody ${a[0]}` },
    'music.createSoundEffect': { e: () => `a sound effect` },
    '.play': { s: (a, o) => `PLAY the sound ${o}` },
    '.startScreenEffect': { s: (a, o) => `START the ${o} screen effect` + (a[0] ? ` for ${a[0]} ms` : '') },
    'effects.clearParticles': { s: a => `CLEAR all effects from ${a[0]}` },
    '.endScreenEffect': { s: (a, o) => `STOP the ${o} screen effect` },
    // --- animation ---
    'animation.runImageAnimation': {
      s: a => `ANIMATE ${a[0]} using ${a[1]}, changing frame every ${a[2]} ms` + (a[3] === 'true' ? ', looping' : ''),
    },
    'animation.runMovementAnimation': { s: a => `MOVE ${a[0]} along a path over ${a[2]} ms` + (a[3] === 'true' ? ', looping' : '') },
    'animation.stopAnimation': { s: a => `STOP animating ${a[1]}` },
    'characterAnimations.loopFrames': { s: a => `ANIMATE ${a[0]} using ${a[1]} every ${a[2]} ms when it is ${a[3]}` },
    // --- maths ---
    'randint': { e: a => `a random number from ${a[0]} to ${a[1]}` },
    'Math.randomRange': { e: a => `a random number from ${a[0]} to ${a[1]}` },
    'Math.percentChance': { e: a => `a ${a[0]}% chance` },
    'Math.pickRandom': { e: a => `a random item from ${a[0]}` },
    'Math.abs': { e: a => `the absolute value of ${a[0]}` },
    'Math.round': { e: a => `${a[0]} rounded` },
    'Math.floor': { e: a => `${a[0]} rounded down` },
    'Math.ceil': { e: a => `${a[0]} rounded up` },
    'Math.sqrt': { e: a => `the square root of ${a[0]}` },
    'Math.min': { e: a => `the smaller of ${a.join(' and ')}` },
    'Math.max': { e: a => `the larger of ${a.join(' and ')}` },
    'Math.idiv': { e: a => `${a[0]} ÷ ${a[1]} (whole number)` },
    'Math.constrain': { e: a => `${a[0]} kept between ${a[1]} and ${a[2]}` },
    'Math.map': { e: a => `${a[0]} mapped from ${a[1]}–${a[2]} to ${a[3]}–${a[4]}` },
    'convertToText': { e: a => `${a[0]} as text` },
    // --- lists & text ---
    '.push': { s: (a, o) => `ADD ${a[0]} to the end of ${o}` },
    '.pop': { s: (a, o) => `REMOVE the last item from ${o}`, e: (a, o) => `the last item of ${o} (removed)` },
    '.shift': { s: (a, o) => `REMOVE the first item from ${o}`, e: (a, o) => `the first item of ${o} (removed)` },
    '.unshift': { s: (a, o) => `ADD ${a[0]} to the start of ${o}` },
    '.insertAt': { s: (a, o) => `INSERT ${a[1]} into ${o} at position ${a[0]}` },
    '.removeAt': { s: (a, o) => `REMOVE item ${a[0]} from ${o}`, e: (a, o) => `item ${a[0]} of ${o} (removed)` },
    '.removeElement': { s: (a, o) => `REMOVE ${a[0]} from ${o}` },
    '.indexOf': { e: (a, o) => `the position of ${a[0]} in ${o}` },
    '.get': { e: (a, o) => `item ${a[0]} of ${o}` },
    '.set': { s: (a, o) => `SET item ${a[0]} of ${o} TO ${a[1]}` },
    '.reverse': { s: (a, o) => `REVERSE ${o}` },
    '._pickRandom': { e: (a, o) => `a random item from ${o}` },
    '.includes': { e: (a, o) => `${o} contains ${a[0]}` },
    '.charAt': { e: (a, o) => `letter ${a[0]} of ${o}` },
    '.substr': { e: (a, o) => `part of ${o} from ${a[0]}` + (a[1] ? `, ${a[1]} letters long` : '') },
    // --- status bars ---
    'statusbars.create': { e: a => `a new ${a[2]} status bar (${a[0]}×${a[1]})` },
    '.attachToSprite': { s: (a, o) => `ATTACH ${o} to ${a[0]}` },
  };

  /*
   * Event registrations: their callback becomes its own section.
   * title(args, params) -> "WHEN ..." heading (no colon)
   * repeat: describes what happens after the END of the handler.
   */
  const EVENTS = {
    'sprites.onOverlap': { title: (a, p) => `WHEN ${aKind(a[0])}${pn(p[0])} overlaps ${aKind(a[1])}${pn(p[1])}` },
    'scene.onOverlapTile': { title: (a, p) => `WHEN ${aKind(a[0])}${pn(p[0])} touches ${a[1]}${pn(p[1])}` },
    'scene.onHitWall': { title: (a, p) => `WHEN ${aKind(a[0])}${pn(p[0])} hits a wall${pn(p[1])}` },
    'scene.onHitTile': { title: (a, p) => `WHEN ${aKind(a[0])}${pn(p[0])} hits ${a[1]}` },
    'sprites.onCreated': { title: (a, p) => `WHEN ${aKind(a[0])}${pn(p[0])} is created` },
    'sprites.onDestroyed': { title: (a, p) => `WHEN ${aKind(a[0])}${pn(p[0])} is destroyed` },
    'info.onCountdownEnd': { title: () => `WHEN the countdown ends` },
    'info.onLifeZero': { title: () => `WHEN lives reach zero` },
    'info.onScore': { title: a => `WHEN the score reaches ${a[0]}` },
    'statusbars.onZero': { title: (a, p) => `WHEN ${aKind(a[0])} status bar${pn(p[0])} reaches zero` },
    'statusbars.onStatusReached': { title: (a, p) => `WHEN ${aKind(a[0])} status bar${pn(p[0])} is ${a[1]} ${a[2]}` },
    'game.onUpdate': { title: () => `EVERY FRAME (on game update)`, repeat: 'runs again next frame' },
    'game.onUpdateInterval': { title: a => `EVERY ${a[0]} ms`, repeat: a => `runs again in ${a[0]} ms` },
    'forever': { title: () => `FOREVER`, repeat: 'goes back to the top' },
    'game.onPaint': { title: () => `WHEN the screen is drawn`, repeat: 'runs again next frame' },
    'game.onShade': { title: () => `WHEN the screen is shaded`, repeat: 'runs again next frame' },
    'timer.after': { title: a => `AFTER ${a[0]} ms` },
    'timer.background': { title: () => `IN THE BACKGROUND` },
    'timer.throttle': { title: a => `AT MOST ONCE EVERY ${a[1]} ms (${unq(a[0])})` },
    'timer.debounce': { title: a => `AFTER ${a[1]} ms OF QUIET (${unq(a[0])})` },
    'control.runInParallel': { title: () => `AT THE SAME TIME` },
    'game.onGameOver': { title: (a, p) => `WHEN the game is over${pn(p[0])}` },
  };

  const NAMESPACES = new Set(('sprites scene game info controller music effects tiles animation timer ' +
    'console statusbars characterAnimations story control loops mp assets images image light ' +
    'textsprite browserEvents blockSettings settings multilights power storyboard minecraft ' +
    'particles palette color texteffects spriteutils scaling extraEffects arcadeEnhancements').split(' '));

  function pn(name) { return name ? ` (${name})` : ''; }
  function unq(s) { return String(s || '').replace(/^"(.*)"$/, '$1'); }
  function onOff(v) { return v === 'true' ? 'ON' : v === 'false' ? 'OFF' : v; }

  // ---------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------

  function analyse(source, tsLib) {
    ts = tsLib;
    if (!ts) throw new Error('TypeScript library is not loaded');
    const sf = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const ctx = {
      sf,
      vars: new Set(),       // names declared as variables or parameters
      functions: new Set(),  // names of user functions
      sections: [],
      warnings: [],
      sectionCount: 0,
    };
    collectNames(sf, ctx);

    const diags = sf.parseDiagnostics || [];
    if (diags.length) {
      const d = diags[0];
      const { line } = sf.getLineAndCharacterOfPosition(d.start || 0);
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      const looksPython = /^\s*def\s+\w+\(|:\s*$/m.test(source) && !/[{};]/.test(source);
      ctx.warnings.push(looksPython
        ? 'This looks like Python. Switch MakeCode to JavaScript and copy that code instead.'
        : `Line ${line + 1}: ${msg}. The results below may be incomplete.`);
    }

    const startStmts = [];
    const events = [];
    const funcs = [];
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st)) {
        if (st.body) funcs.push(st);
        continue;
      }
      if (handlerCall(st)) { events.push(st); continue; }
      if (ts.isModuleDeclaration(st)) {
        if (st.name && st.name.text === 'SpriteKind') {
          const kinds = [];
          st.forEachChild(function visit(n) {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) kinds.push(n.name.text);
            n.forEachChild(visit);
          });
          if (kinds.length) ctx.kinds = kinds;
        } else {
          ctx.warnings.push(`Skipped "namespace ${st.name.getText()}" (custom blocks / namespaces are not shown).`);
        }
        continue;
      }
      if (ts.isVariableStatement(st) && isHoistedDeclaration(st)) continue;
      if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) ||
          ts.isClassDeclaration(st) || ts.isImportDeclaration(st)) {
        ctx.warnings.push(`Skipped ${ts.SyntaxKind[st.kind].replace('Declaration', ' declaration').toLowerCase()} on line ${lineOf(sf, st)}.`);
        continue;
      }
      if (ts.isEmptyStatement(st)) continue;
      startStmts.push(st);
    }

    if (startStmts.length) {
      makeSection(ctx, { kind: 'start', title: 'ON START', body: startStmts });
    }
    for (const st of events) {
      const call = handlerCall(st);
      const info = describeEvent(call, ctx);
      makeSection(ctx, { kind: 'event', title: info.title, body: info.body, repeat: info.repeat, line: lineOf(sf, st) });
    }
    for (const fn of funcs) {
      const params = fn.parameters.map(p => p.name.getText());
      const name = fn.name ? fn.name.text : 'function';
      makeSection(ctx, {
        kind: 'function',
        title: `FUNCTION ${name}` + (params.length ? `(${params.join(', ')})` : ''),
        body: fn.body.statements, line: lineOf(sf, fn),
      });
    }

    if (!ctx.sections.length && !ctx.warnings.length) {
      ctx.warnings.push('No code found. Paste the JavaScript from your MakeCode project.');
    }
    return { sections: ctx.sections, warnings: ctx.warnings, kinds: ctx.kinds || [] };
  }

  function lineOf(sf, node) { return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1; }

  function collectNames(sf, ctx) {
    (function visit(n) {
      if (ts.isVariableDeclaration(n) || ts.isParameter(n)) {
        if (ts.isIdentifier(n.name)) ctx.vars.add(n.name.text);
      } else if (ts.isFunctionDeclaration(n) && n.name) {
        ctx.functions.add(n.name.text);
      }
      n.forEachChild(visit);
    })(sf);
  }

  /** Blocks writes `let mySprite: Sprite = null` at the top of main.ts. Hide those. */
  function isHoistedDeclaration(st) {
    return st.declarationList.declarations.every(d =>
      !d.initializer || d.initializer.kind === ts.SyntaxKind.NullKeyword);
  }

  /** If a statement registers an event handler (a call whose last argument is a function), return the call. */
  function handlerCall(st) {
    if (!ts.isExpressionStatement(st)) return null;
    const call = st.expression;
    if (!ts.isCallExpression(call) || !call.arguments.length) return null;
    const last = call.arguments[call.arguments.length - 1];
    if (!isFunctionLike(last)) return null;
    // Leave list.forEach(...) etc. inline - those are loops, not events.
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee) && /^(forEach|map|filter|sort|find|every|some|reduce)$/.test(callee.name.text)) return null;
    return call;
  }

  function isFunctionLike(n) { return n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n)); }

  function calleeName(call) {
    const e = call.expression;
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.getText().replace(/\s+/g, '');
    return null;
  }

  function describeEvent(call, ctx) {
    const fn = call.arguments[call.arguments.length - 1];
    const params = fn.parameters.map(p => p.name.getText());
    const argNodes = call.arguments.slice(0, -1);
    const args = argNodes.map(a => expr(a, ctx));
    const body = ts.isBlock(fn.body) ? fn.body.statements : [ts.factory.createExpressionStatement(fn.body)];
    const name = calleeName(call) || '';
    const callee = call.expression;

    // controller.A.onEvent(ControllerButtonEvent.Pressed, ...)
    // controller.player2.A.onEvent(...)
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'onEvent' && /^controller\./.test(name)) {
      const parts = name.split('.').slice(1, -1); // e.g. ["A"] or ["player2", "A"]
      const btn = parts[parts.length - 1];
      const player = parts.length > 1 ? capFirst(titleWords(parts[0]).replace(/(\D)(\d)/, '$1 $2')) + ' ' : '';
      const evName = argNodes[0] && ts.isPropertyAccessExpression(argNodes[0]) ? argNodes[0].name.text : args[0];
      return {
        title: `WHEN ${player}${BUTTONS[btn] || titleWords(btn)} Button ${BUTTON_EVENTS[evName] || evName}`,
        body,
      };
    }
    // controller.player1.onButtonEvent(ControllerButton.A, ControllerButtonEvent.Pressed, ...)
    if (/\.onButtonEvent$/.test(name)) {
      const btn = argNodes[0] && ts.isPropertyAccessExpression(argNodes[0]) ? argNodes[0].name.text : args[0];
      const evName = argNodes[1] && ts.isPropertyAccessExpression(argNodes[1]) ? argNodes[1].name.text : args[1];
      const m = /player(\d)/i.exec(name);
      return {
        title: `WHEN ${m ? 'Player ' + m[1] + ' ' : 'any player\'s '}${BUTTONS[btn] || btn} Button ${BUTTON_EVENTS[evName] || evName}` + (params.length ? pn(params[0]) : ''),
        body,
      };
    }

    const ev = EVENTS[name];
    if (ev) {
      const repeat = typeof ev.repeat === 'function' ? ev.repeat(args) : ev.repeat;
      return { title: ev.title(args, params), body, repeat };
    }

    // Unknown: "sprites.onSomething(x, ...)" -> "WHEN something (x)"
    const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : name;
    let phrase = words(method.replace(/^on(?=[A-Z])/, ''));
    if (ts.isPropertyAccessExpression(callee) && isValueExpr(callee.expression, ctx)) {
      phrase = `${expr(callee.expression, ctx)}: ${phrase}`;
    }
    return {
      title: `WHEN ${phrase}` + (args.length ? ` ${args.join(', ')}` : '') + (params.length ? ` (${params.join(', ')})` : ''),
      body,
    };
  }

  // ---------------------------------------------------------------------
  // Sections: pseudocode lines + flowchart, built in one pass
  // ---------------------------------------------------------------------

  function makeSection(ctx, def) {
    const id = 's' + (++ctx.sectionCount);
    const sec = { id, kind: def.kind, title: def.title, line: def.line, parent: def.parent };
    const flow = new Flow(id);
    const lines = [];
    const startId = flow.node(def.title, 'terminal');
    lines.push({ depth: 0, text: def.title + ':', nodeId: startId });
    const b = { ctx, flow, lines, section: sec, loops: [] };
    let pending = buildBlock(b, def.body, [{ id: startId }], 1);
    if (def.body.length === 0) lines.push({ depth: 1, text: '(nothing happens yet)', nodeId: null });

    const endText = def.repeat ? `END (${def.repeat})` : 'END';
    if (pending.length || flow.returns.length || !flow.edges.length) {
      const endId = flow.node(endText, 'terminal');
      flow.link(pending, endId);
      flow.link(flow.returns, endId);
    }
    sec.lines = lines;
    sec.mermaid = flow.toMermaid();
    // Keep nested callbacks (timers etc.) right after their parent.
    ctx.sections.push(sec);
    for (const child of b.children || []) makeSection(ctx, child);
    return sec;
  }

  class Flow {
    constructor(prefix) {
      this.prefix = prefix;
      this.nodes = [];
      this.edges = [];
      this.returns = []; // pending links into the END node
      this.count = 0;
    }
    node(text, shape) {
      const id = this.prefix + 'n' + (++this.count);
      this.nodes.push({ id, text, shape });
      return id;
    }
    link(pending, to) {
      for (const p of pending) this.edges.push({ from: p.id, to, label: p.label });
    }
    toMermaid() {
      const out = ['flowchart TD'];
      for (const n of this.nodes) {
        const t = '"' + wrap(n.text, n.shape === 'decision' ? 22 : 30).map(escapeLabel).join('<br/>') + '"';
        let shape;
        switch (n.shape) {
          case 'terminal': shape = `([${t}])`; break;
          case 'decision': shape = `{${t}}`; break;
          case 'io': shape = `[/${t}/]`; break;
          case 'sub': shape = `[[${t}]]`; break;
          default: shape = `[${t}]`;
        }
        out.push(`  ${n.id}${shape}`);
        out.push(`  class ${n.id} ${n.shape || 'process'}`);
      }
      for (const e of this.edges) {
        out.push(`  ${e.from} -->${e.label ? '|' + escapeLabel(e.label) + '|' : ''} ${e.to}`);
      }
      return out.join('\n');
    }
  }

  /** Word-wrap a label into lines of about `width` characters. */
  function wrap(text, width) {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      if (line && (line + ' ' + word).length > width) { out.push(line); line = word; }
      else line = line ? line + ' ' + word : word;
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  function escapeLabel(s) {
    return String(s)
      // Mermaid's entity codes show up literally in SVG labels, so use
      // look-alike characters instead of escapes.
      .replace(/"([^"]*)"/g, '“$1”')
      .replace(/"/g, '”')
      .replace(/</g, '＜')
      .replace(/>/g, '＞')
      .replace(/#/g, '＃')
      .replace(/\|/g, '¦')
      .replace(/[\r\n]+/g, ' ');
  }

  /** Build statements; returns the list of pending exits ({id, label}). */
  function buildBlock(b, stmts, pending, depth) {
    for (const st of stmts) {
      addComments(b, st, depth);
      pending = buildStatement(b, st, pending, depth);
    }
    return pending;
  }

  function addComments(b, st, depth) {
    const text = b.ctx.sf.text;
    const ranges = ts.getLeadingCommentRanges(text, st.pos) || [];
    for (const r of ranges) {
      let c = text.slice(r.pos, r.end);
      c = c.replace(/^\/\/\s?/, '').replace(/^\/\*+\s?|\s*\*+\/$/g, '').replace(/^\s*\*\s?/gm, '').trim();
      if (c) for (const ln of c.split('\n')) b.lines.push({ depth, text: 'NOTE: ' + ln.trim(), nodeId: null, note: true });
    }
  }

  function simple(b, pending, depth, text, shape) {
    const id = b.flow.node(text, shape || 'process');
    b.flow.link(pending, id);
    b.lines.push({ depth, text, nodeId: id });
    return [{ id }];
  }

  function buildStatement(b, st, pending, depth) {
    const ctx = b.ctx, flow = b.flow;

    if (ts.isBlock(st)) return buildBlock(b, st.statements, pending, depth);
    if (ts.isEmptyStatement(st)) return pending;

    if (ts.isIfStatement(st)) {
      return buildIf(b, st, pending, depth, false);
    }

    if (ts.isWhileStatement(st)) {
      const cond = expr(st.expression, ctx);
      const forever = st.expression.kind === ts.SyntaxKind.TrueKeyword;
      const c = flow.node(forever ? 'Keep going forever' : cond + '?', forever ? 'process' : 'decision');
      flow.link(pending, c);
      b.lines.push({ depth, text: forever ? 'REPEAT FOREVER:' : `WHILE ${cond}:`, nodeId: c });
      const loop = { breaks: [], cont: c };
      b.loops.push(loop);
      const out = buildBlock(b, bodyOf(st.statement), [{ id: c, label: forever ? undefined : 'Yes' }], depth + 1);
      b.loops.pop();
      flow.link(out, c);
      return (forever ? [] : [{ id: c, label: 'No' }]).concat(loop.breaks);
    }

    if (ts.isDoStatement(st)) {
      const cond = expr(st.expression, ctx);
      b.lines.push({ depth, text: 'DO:', nodeId: null });
      const firstIdx = flow.nodes.length;
      const loop = { breaks: [], cont: null };
      b.loops.push(loop);
      // A junction node so the loop has somewhere to come back to.
      const j = flow.node('Start of loop', 'process');
      flow.link(pending, j);
      const out = buildBlock(b, bodyOf(st.statement), [{ id: j }], depth + 1);
      b.loops.pop();
      const c = flow.node(cond + '?', 'decision');
      flow.link(out, c);
      flow.edges.push({ from: c, to: j, label: 'Yes' });
      b.lines.push({ depth, text: `REPEAT WHILE ${cond}`, nodeId: c });
      void firstIdx;
      return [{ id: c, label: 'No' }].concat(loop.breaks);
    }

    if (ts.isForStatement(st)) return buildFor(b, st, pending, depth);

    if (ts.isForOfStatement(st) || ts.isForInStatement(st)) {
      const v = st.initializer.kind === ts.SyntaxKind.VariableDeclarationList
        ? st.initializer.declarations[0].name.getText() : st.initializer.getText();
      const list = expr(st.expression, ctx);
      const isOf = ts.isForOfStatement(st);
      const c = flow.node(`Any ${isOf ? 'items' : 'keys'} left in ${list}?`, 'decision');
      flow.link(pending, c);
      b.lines.push({ depth, text: `FOR EACH ${v} IN ${list}:`, nodeId: c });
      const set = flow.node(`SET ${v} TO the next ${isOf ? 'item' : 'key'}`, 'process');
      flow.edges.push({ from: c, to: set, label: 'Yes' });
      const loop = { breaks: [], cont: c };
      b.loops.push(loop);
      const out = buildBlock(b, bodyOf(st.statement), [{ id: set }], depth + 1);
      b.loops.pop();
      flow.link(out, c);
      return [{ id: c, label: 'No' }].concat(loop.breaks);
    }

    if (ts.isSwitchStatement(st)) {
      const subject = expr(st.expression, ctx);
      b.lines.push({ depth, text: `CHECK ${subject}:`, nodeId: null });
      const loop = { breaks: [], cont: b.loops.length ? b.loops[b.loops.length - 1].cont : null, isSwitch: true };
      b.loops.push(loop);
      let exits = [];
      let fall = [];
      for (const clause of st.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          const val = expr(clause.expression, ctx);
          const c = flow.node(`${subject} = ${val}?`, 'decision');
          flow.link(pending, c);
          b.lines.push({ depth: depth + 1, text: `CASE ${val}:`, nodeId: c });
          const out = buildBlock(b, clause.statements, [{ id: c, label: 'Yes' }].concat(fall), depth + 2);
          fall = out; // JavaScript falls through without a break
          pending = [{ id: c, label: 'No' }];
        } else {
          b.lines.push({ depth: depth + 1, text: 'OTHERWISE:', nodeId: null });
          pending = buildBlock(b, clause.statements, pending.concat(fall), depth + 2);
          fall = [];
        }
      }
      b.loops.pop();
      exits = pending.concat(fall, loop.breaks);
      return exits;
    }

    if (ts.isReturnStatement(st)) {
      const text = st.expression ? `RETURN ${expr(st.expression, ctx)}` : 'STOP here (return)';
      const id = flow.node(text, 'process');
      flow.link(pending, id);
      b.lines.push({ depth, text, nodeId: id });
      flow.returns.push({ id });
      return [];
    }

    if (ts.isBreakStatement(st)) {
      const loop = b.loops[b.loops.length - 1];
      if (loop && loop.isSwitch) { loop.breaks.push(...pending); return []; }
      const id = flow.node('STOP the loop', 'process');
      flow.link(pending, id);
      b.lines.push({ depth, text: 'STOP the loop (break)', nodeId: id });
      if (loop) loop.breaks.push({ id });
      return [];
    }

    if (ts.isContinueStatement(st)) {
      const loop = [...b.loops].reverse().find(l => !l.isSwitch);
      const id = flow.node('SKIP to the next time round the loop', 'process');
      flow.link(pending, id);
      b.lines.push({ depth, text: 'SKIP to the next time round the loop (continue)', nodeId: id });
      if (loop && loop.cont) flow.edges.push({ from: id, to: loop.cont });
      return [];
    }

    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = d.name.getText();
        if (!d.initializer) {
          pending = simple(b, pending, depth, `CREATE a variable called ${name}`);
        } else if (isFunctionLike(d.initializer)) {
          pending = simple(b, pending, depth, `CREATE a function called ${name}`);
        } else {
          const io = { io: false };
          const v = expr(d.initializer, ctx, io);
          pending = simple(b, pending, depth, `SET ${name} TO ${v}`, io.io ? 'io' : 'process');
        }
      }
      return pending;
    }

    if (ts.isExpressionStatement(st)) {
      const e = st.expression;
      // Callback registered inside other code (timer.after, nested events)
      const h = handlerCall(st);
      if (h) {
        const info = describeEvent(h, ctx);
        const fnBody = info.body;
        const id = flow.node(`${info.title} → see its own flowchart`, 'sub');
        flow.link(pending, id);
        b.lines.push({ depth, text: info.title + ':', nodeId: id });
        // Pseudocode shows the body inline; the flowchart gets its own section.
        // (Its node ids belong to the child chart, so they are not linked here.)
        const tmp = { ctx, flow: new Flow('tmp'), lines: b.lines, section: b.section, loops: [] };
        const before = b.lines.length;
        buildBlock(tmp, fnBody, [], depth + 1);
        for (let i = before; i < b.lines.length; i++) b.lines[i].nodeId = null;
        (b.children = b.children || []).push({
          kind: 'event', title: info.title, body: fnBody, repeat: info.repeat,
          line: lineOf(ctx.sf, st), parent: b.section.title,
        });
        return [{ id }];
      }
      const io = { io: false };
      const r = statementText(e, ctx, io);
      return simple(b, pending, depth, r.text, r.shape || (io.io ? 'io' : 'process'));
    }

    if (ts.isFunctionDeclaration(st)) {
      b.lines.push({ depth, text: `(defines a function called ${st.name ? st.name.text : '?'} - see below)`, nodeId: null });
      if (st.body) {
        const params = st.parameters.map(p => p.name.getText());
        (b.children = b.children || []).push({
          kind: 'function', title: `FUNCTION ${st.name ? st.name.text : ''}` + (params.length ? `(${params.join(', ')})` : ''),
          body: st.body.statements, line: lineOf(ctx.sf, st),
        });
      }
      return pending;
    }

    if (ts.isTryStatement(st)) {
      b.lines.push({ depth, text: 'TRY:', nodeId: null });
      pending = buildBlock(b, st.tryBlock.statements, pending, depth + 1);
      if (st.finallyBlock) {
        b.lines.push({ depth, text: 'FINALLY:', nodeId: null });
        pending = buildBlock(b, st.finallyBlock.statements, pending, depth + 1);
      }
      return pending;
    }

    if (ts.isThrowStatement(st)) {
      const id = flow.node(`STOP WITH ERROR ${expr(st.expression, ctx)}`, 'process');
      flow.link(pending, id);
      b.lines.push({ depth, text: `STOP WITH ERROR ${expr(st.expression, ctx)}`, nodeId: id });
      flow.returns.push({ id });
      return [];
    }

    // Anything else: show the code itself.
    return simple(b, pending, depth, st.getText().replace(/\s+/g, ' ').slice(0, 80));
  }

  function bodyOf(st) { return ts.isBlock(st) ? st.statements : [st]; }

  function buildIf(b, st, pending, depth, isElseIf) {
    const flow = b.flow;
    const cond = expr(st.expression, b.ctx);
    const c = flow.node(cond + '?', 'decision');
    flow.link(pending, c);
    b.lines.push({ depth, text: `${isElseIf ? 'ELSE IF' : 'IF'} ${cond}:`, nodeId: c });
    const yes = buildBlock(b, bodyOf(st.thenStatement), [{ id: c, label: 'Yes' }], depth + 1);
    let no = [{ id: c, label: 'No' }];
    if (st.elseStatement) {
      if (ts.isIfStatement(st.elseStatement)) {
        no = buildIf(b, st.elseStatement, no, depth, true);
      } else {
        b.lines.push({ depth, text: 'ELSE:', nodeId: null });
        no = buildBlock(b, bodyOf(st.elseStatement), no, depth + 1);
      }
    }
    return yes.concat(no);
  }

  function buildFor(b, st, pending, depth) {
    const ctx = b.ctx, flow = b.flow;
    const parsed = parseCountingLoop(st, ctx);
    const loop = { breaks: [], cont: null };
    if (parsed && parsed.times) {
      // REPEAT n TIMES
      const c = flow.node(`Repeated ${parsed.times} times yet?`, 'decision');
      flow.link(pending, c);
      b.lines.push({ depth, text: `REPEAT ${parsed.times} TIMES:`, nodeId: c });
      loop.cont = c;
      b.loops.push(loop);
      const out = buildBlock(b, bodyOf(st.statement), [{ id: c, label: 'No' }], depth + 1);
      b.loops.pop();
      flow.link(out, c);
      return [{ id: c, label: 'Yes' }].concat(loop.breaks);
    }

    let initText, condText, stepText, header;
    if (parsed) {
      initText = `SET ${parsed.v} TO ${parsed.from}`;
      condText = `${parsed.v} ${parsed.inclusive ? '≤' : '<'} ${parsed.to}?`;
      stepText = parsed.step === '1' ? `CHANGE ${parsed.v} BY 1` : `CHANGE ${parsed.v} BY ${parsed.step}`;
      header = parsed.inclusive
        ? `FOR ${parsed.v} FROM ${parsed.from} TO ${parsed.to}:`
        : `FOR ${parsed.v} FROM ${parsed.from} UP TO (not including) ${parsed.to}:`;
      if (parsed.step !== '1') header = header.replace(/:$/, ` COUNTING BY ${parsed.step}:`);
    } else {
      initText = st.initializer ? statementLike(st.initializer, ctx) : null;
      condText = st.condition ? expr(st.condition, ctx) + '?' : 'Keep going forever';
      stepText = st.incrementor ? statementText(st.incrementor, ctx, {}).text : null;
      header = `LOOP` + (initText ? ` (start: ${initText})` : '') + (st.condition ? ` WHILE ${expr(st.condition, ctx)}` : '') +
        (stepText ? ` (each time: ${stepText})` : '') + ':';
    }
    if (initText) pending = [{ id: (() => { const i = flow.node(initText, 'process'); flow.link(pending, i); return i; })() }];
    const c = flow.node(condText, st.condition ? 'decision' : 'process');
    flow.link(pending, c);
    b.lines.push({ depth, text: header, nodeId: c });
    const inc = stepText ? flow.node(stepText, 'process') : null;
    loop.cont = inc || c;
    b.loops.push(loop);
    const out = buildBlock(b, bodyOf(st.statement), [{ id: c, label: st.condition ? 'Yes' : undefined }], depth + 1);
    b.loops.pop();
    if (inc) { flow.link(out, inc); flow.edges.push({ from: inc, to: c }); }
    else flow.link(out, c);
    return (st.condition ? [{ id: c, label: 'No' }] : []).concat(loop.breaks);
  }

  /** Recognise `for (let i = A; i < B; i++)` style loops. */
  function parseCountingLoop(st, ctx) {
    const init = st.initializer, cond = st.condition, inc = st.incrementor;
    if (!init || !cond || !inc) return null;
    if (!ts.isVariableDeclarationList(init) || init.declarations.length !== 1) return null;
    const d = init.declarations[0];
    if (!ts.isIdentifier(d.name) || !d.initializer) return null;
    const v = d.name.text;
    if (!ts.isBinaryExpression(cond) || !ts.isIdentifier(cond.left) || cond.left.text !== v) return null;
    const op = cond.operatorToken.kind;
    if (op !== ts.SyntaxKind.LessThanToken && op !== ts.SyntaxKind.LessThanEqualsToken) return null;
    let step = null;
    if ((ts.isPostfixUnaryExpression(inc) || ts.isPrefixUnaryExpression(inc)) &&
        inc.operator === ts.SyntaxKind.PlusPlusToken && ts.isIdentifier(inc.operand) && inc.operand.text === v) step = '1';
    else if (ts.isBinaryExpression(inc) && inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
        ts.isIdentifier(inc.left) && inc.left.text === v) step = expr(inc.right, ctx);
    if (!step) return null;
    const from = expr(d.initializer, ctx);
    const to = expr(cond.right, ctx);
    const inclusive = op === ts.SyntaxKind.LessThanEqualsToken;
    // Blocks' "repeat N times" is `for (let index = 0; index < N; index++)`.
    if (from === '0' && !inclusive && step === '1' && !usesName(st.statement, v)) {
      return { times: to };
    }
    return { v, from, to, inclusive, step };
  }

  function usesName(node, name) {
    let found = false;
    (function visit(n) {
      if (found) return;
      if (ts.isIdentifier(n) && n.text === name) { found = true; return; }
      n.forEachChild(visit);
    })(node);
    return found;
  }

  function statementLike(node, ctx) {
    if (ts.isVariableDeclarationList(node)) {
      return node.declarations.map(d => d.initializer ? `SET ${d.name.getText()} TO ${expr(d.initializer, ctx)}` : `CREATE ${d.name.getText()}`).join(', ');
    }
    return statementText(node, ctx, {}).text;
  }

  // ---------------------------------------------------------------------
  // Statements that are a single expression (assignments, calls...)
  // ---------------------------------------------------------------------

  function statementText(e, ctx, io) {
    while (ts.isParenthesizedExpression(e)) e = e.expression;

    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      const target = target_(e.left, ctx);
      const K = ts.SyntaxKind;
      if (op === K.EqualsToken) return { text: `SET ${target} TO ${expr(e.right, ctx, io)}` };
      if (op === K.PlusEqualsToken) return { text: `CHANGE ${target} BY ${expr(e.right, ctx, io)}` };
      if (op === K.MinusEqualsToken) return { text: `CHANGE ${target} BY ${negate(expr(e.right, ctx, io))}` };
      if (op === K.AsteriskEqualsToken) return { text: `MULTIPLY ${target} BY ${expr(e.right, ctx, io)}` };
      if (op === K.SlashEqualsToken) return { text: `DIVIDE ${target} BY ${expr(e.right, ctx, io)}` };
    }
    if ((ts.isPostfixUnaryExpression(e) || ts.isPrefixUnaryExpression(e)) &&
        (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)) {
      return { text: `CHANGE ${target_(e.operand, ctx)} BY ${e.operator === ts.SyntaxKind.PlusPlusToken ? '1' : '-1'}` };
    }
    if (ts.isCallExpression(e)) {
      const name = calleeName(e);
      if (name && ts.isIdentifier(e.expression) && ctx.functions.has(name)) {
        const args = e.arguments.map(a => expr(a, ctx, io));
        return { text: `CALL ${name}` + (args.length ? ` WITH ${args.join(', ')}` : ''), shape: 'sub' };
      }
      const r = phraseCall(e, ctx, 's', io);
      if (r) return { text: r };
      return { text: genericCall(e, ctx, true, io) };
    }
    if (ts.isDeleteExpression(e)) return { text: `DELETE ${expr(e.expression, ctx)}` };
    return { text: expr(e, ctx, io) };
  }

  /** The left-hand side of an assignment: "mySprite's x velocity", "item 2 of list". */
  function target_(n, ctx) { return expr(n, ctx); }

  /** Look the call up in the phrasebook. kind = 's' (statement) or 'e' (expression). */
  function phraseCall(call, ctx, kind, io) {
    const callee = call.expression;
    const full = calleeName(call);
    let entry = full && CALLS[full], obj = null;
    if (!entry && ts.isPropertyAccessExpression(callee)) {
      entry = CALLS['.' + callee.name.text];
      obj = expr(callee.expression, ctx, io);
    }
    if (!entry) return null;
    let fn = entry[kind];
    // An expression-only phrase used as a statement: "DO ..." it.
    if (!fn && kind === 's' && entry.e) fn = (a, o) => 'DO ' + entry.e(a, o);
    // A statement-only phrase used in an expression.
    if (!fn && kind === 'e' && entry.s) fn = (a, o) => entry.s(a, o).replace(/^[A-Z]+\s/, m => m.toLowerCase());
    if (!fn) return null;
    if (entry.io && io) io.io = true;
    const args = call.arguments.map(a => expr(a, ctx, io));
    return fn(args, obj);
  }

  function genericCall(call, ctx, asStatement, io) {
    const callee = call.expression;
    const args = call.arguments.map(a => expr(a, ctx, io));
    let method, recv = '';
    if (ts.isPropertyAccessExpression(callee)) {
      method = callee.name.text;
      if (isValueExpr(callee.expression, ctx)) recv = expr(callee.expression, ctx, io);
    } else if (ts.isIdentifier(callee)) {
      method = callee.text;
      if (ctx.functions.has(method)) {
        return (asStatement ? `CALL ${method}` : `the result of ${method}`) + (args.length ? ` WITH ${args.join(', ')}` : '');
      }
    } else {
      return call.getText().replace(/\s+/g, ' ');
    }
    let w = words(method).split(' ');
    if (asStatement) w[0] = w[0].toUpperCase();
    let text = w.join(' ');
    if (recv) text += asStatement ? ` ON ${recv}` : ` of ${recv}`;
    if (args.length) text += asStatement ? `: ${args.join(', ')}` : ` (${args.join(', ')})`;
    return text;
  }

  /**
   * Is this expression a value (a variable, a list, a sprite...) rather than a
   * namespace like `sprites` or `scene`? Namespaces aren't mentioned in output.
   */
  function isValueExpr(n, ctx) {
    if (ts.isIdentifier(n)) {
      if (ctx.vars.has(n.text)) return true;
      // Known MakeCode namespaces and PascalCase enums (SpriteKind...) are not values.
      if (NAMESPACES.has(n.text) || /^[A-Z]/.test(n.text)) return false;
      return true; // an undeclared lower-case name is most likely a variable
    }
    if (n.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isPropertyAccessExpression(n)) return isValueExpr(n.expression, ctx);
    return true; // calls, element access, literals...
  }

  // ---------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------

  const BIN_OPS = {
    EqualsEqualsToken: '=', EqualsEqualsEqualsToken: '=',
    ExclamationEqualsToken: '≠', ExclamationEqualsEqualsToken: '≠',
    LessThanToken: '<', GreaterThanToken: '>', LessThanEqualsToken: '≤', GreaterThanEqualsToken: '≥',
    AmpersandAmpersandToken: 'AND', BarBarToken: 'OR',
    PlusToken: '+', MinusToken: '-', AsteriskToken: '×', SlashToken: '÷', PercentToken: 'remainder',
    AsteriskAsteriskToken: 'to the power of',
  };

  function expr(n, ctx, io) {
    if (!n) return '';
    const K = ts.SyntaxKind;
    switch (n.kind) {
      case K.NumericLiteral: return n.text;
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral: return `"${n.text}"`;
      case K.TrueKeyword: return 'true';
      case K.FalseKeyword: return 'false';
      case K.NullKeyword: return 'nothing';
      case K.ThisKeyword: return 'this';
      case K.Identifier: return n.text === 'undefined' ? 'nothing' : n.text;
    }
    if (ts.isTemplateExpression(n)) {
      const parts = [];
      if (n.head.text) parts.push(`"${n.head.text}"`);
      for (const span of n.templateSpans) {
        parts.push(expr(span.expression, ctx, io));
        if (span.literal.text) parts.push(`"${span.literal.text}"`);
      }
      return parts.join(' + ');
    }
    if (ts.isParenthesizedExpression(n)) return '(' + expr(n.expression, ctx, io) + ')';
    if (ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n) ||
        (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))) return expr(n.expression, ctx, io);
    if (ts.isPrefixUnaryExpression(n)) {
      const v = expr(n.operand, ctx, io);
      switch (n.operator) {
        case K.ExclamationToken: return `NOT ${v}`;
        case K.MinusToken: return '-' + v;
        case K.PlusToken: return v;
        case K.PlusPlusToken: return `(${v} + 1)`;
        case K.MinusMinusToken: return `(${v} - 1)`;
      }
      return n.getText();
    }
    if (ts.isPostfixUnaryExpression(n)) return expr(n.operand, ctx, io);
    if (ts.isBinaryExpression(n)) {
      const opName = K[n.operatorToken.kind];
      const l = expr(n.left, ctx, io), r = expr(n.right, ctx, io);
      if (opName === 'PercentToken') return `the remainder of ${l} ÷ ${r}`;
      if (opName === 'EqualsToken') return `(SET ${l} TO ${r})`;
      const op = BIN_OPS[opName];
      return op ? `${l} ${op} ${r}` : `${l} ${n.operatorToken.getText()} ${r}`;
    }
    if (ts.isConditionalExpression(n)) {
      return `(${expr(n.whenTrue, ctx, io)} IF ${expr(n.condition, ctx, io)}, OTHERWISE ${expr(n.whenFalse, ctx, io)})`;
    }
    if (ts.isPropertyAccessExpression(n)) return propText(n, ctx, io);
    if (ts.isElementAccessExpression(n)) {
      return `item ${expr(n.argumentExpression, ctx, io)} of ${expr(n.expression, ctx, io)}`;
    }
    if (ts.isArrayLiteralExpression(n)) {
      if (!n.elements.length) return 'an empty list';
      if (n.elements.every(el => ts.isTaggedTemplateExpression(el)) && n.elements.length > 2) {
        return `a list of ${n.elements.length} images`;
      }
      return 'the list [' + n.elements.map(x => expr(x, ctx, io)).join(', ') + ']';
    }
    if (ts.isTaggedTemplateExpression(n)) return taggedText(n);
    if (ts.isCallExpression(n)) {
      const r = phraseCall(n, ctx, 'e', io);
      if (r) return r;
      return genericCall(n, ctx, false, io);
    }
    if (ts.isNewExpression(n)) return `a new ${n.expression.getText()}`;
    if (isFunctionLike(n)) return 'a function';
    if (ts.isObjectLiteralExpression(n)) return 'an object';
    return n.getText().replace(/\s+/g, ' ');
  }

  function propText(n, ctx, io) {
    const obj = n.expression, name = n.name.text;
    // controller.A -> "the A button", controller.player2.A -> "player 2's A button"
    const full = n.getText().replace(/\s+/g, '');
    let m;
    if ((m = /^controller\.(?:(player\d)\.)?(\w+)$/.exec(full)) && BUTTONS[m[2]]) {
      return (m[1] ? m[1].replace(/(\D)(\d)/, '$1 $2') + "'s " : 'the ') + BUTTONS[m[2]] + ' button';
    }
    if (isValueExpr(obj, ctx)) {
      const o = expr(obj, ctx, io);
      if (name === 'length') return `the length of ${o}`;
      return `${o}'s ${PROPS[name] || words(name)}`;
    }
    // Namespace or enum member: SpriteKind.Player -> "Player", effects.fire -> "fire"
    if (/^[A-Z]/.test(name) || (ts.isIdentifier(obj) && /^[A-Z]/.test(obj.text))) return titleWords(name);
    return words(name);
  }

  function taggedText(n) {
    const tag = n.tag.getText().replace(/\s+/g, '');
    const tpl = n.template;
    const raw = ts.isNoSubstitutionTemplateLiteral(tpl) ? tpl.text : tpl.getText();
    const name = raw.trim();
    switch (tag) {
      case 'img': {
        const rows = raw.split('\n').map(r => r.trim()).filter(Boolean);
        const cols = rows.length ? rows[0].split(/\s+/).length : 0;
        return rows.length ? `a ${cols}×${rows.length} image` : 'an image';
      }
      case 'assets.image': return `the image "${name}"`;
      case 'assets.tile': return `the "${name}" tile`;
      case 'assets.animation': return `the animation "${name}"`;
      case 'assets.tilemap':
      case 'tilemap': return `the tilemap "${name}"`;
      case 'assets.song': return `the song "${name}"`;
      case 'hex': return 'some data';
      default: return `${tag} "${name.slice(0, 20)}"`;
    }
  }

  return { analyse, _words: words };
});
