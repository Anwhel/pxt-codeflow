# Codeflow

Codeflow shows a MakeCode Arcade game, or a Unity game's C# scripts, as **plain-English pseudocode** and **flowcharts**.
It is built for students learning to read and explain code.

![Codeflow showing an overlap event as pseudocode next to its flowchart](docs/screenshot.png)

```
WHEN A Button Pressed:
    IF mySprite is hitting a wall on the Bottom:
        SET mySprite's y velocity TO -150
```

Each part of the game gets its own pseudocode and flowchart:

- **ON START**
- each event, e.g. **WHEN A Button Pressed** or **WHEN a Player overlaps an Enemy**
- each **FUNCTION**

Hover over a line of pseudocode to highlight it in the flowchart.

Flowcharts use the standard shapes:

| Shape | Meaning |
| --- | --- |
| Oval | Start / End |
| Rectangle | An action |
| Diamond | A decision (Yes / No) |
| Parallelogram | Input / Output (messages, speech, asking the player) |
| Double-sided box | Run a function / timer |

You can copy the pseudocode, save flowcharts as PNG or SVG, or print the whole page.

## Using it (students)

1. Open your game in MakeCode Arcade and click **JavaScript** at the top.
2. Select all the code (Ctrl+A) and copy it (Ctrl+C).
3. Open the Codeflow page, paste the code and click **Show pseudocode & flowcharts**.

Block projects work too, because MakeCode turns blocks into JavaScript.
Everything runs in the browser and nothing is uploaded.

## Unity (C#)

On the web page, choose **Unity (C#)**, then paste a script or click **Add .cs files**.
You can also drag scripts from the project's `Assets` folder onto the box. Several scripts
can be added at once, and each script gets its own group of sections:

| In the script | Codeflow section |
| --- | --- |
| fields (`public float speed = 5f;`) | **VARIABLES**, noting which ones can be changed in the Inspector |
| `Awake`, `Start` | **WHEN this object is created** / **WHEN this object starts** |
| `Update`, `FixedUpdate`, `LateUpdate` | **EVERY FRAME** / **EVERY PHYSICS STEP** |
| `OnCollisionEnter2D(other)`, `OnTriggerEnter(other)`, … | **WHEN this object hits something (other)**, **WHEN something (other) enters this object's trigger**, … |
| `IEnumerator` methods | **COROUTINE** (`yield return new WaitForSeconds(2)` becomes `WAIT 2 seconds`) |
| your own methods | **FUNCTION** |

Both 2D and 3D scripts work. Common Unity commands get plain-English wording, for example:
- `Input.GetKeyDown(KeyCode.Space)` becomes `the Space key is pressed`.
- `Random.Range(0, 3)` becomes `a random whole number from 0 up to (not including) 3`.

Unity mode is only on the web page. Inside the MakeCode editor, Codeflow is always in
MakeCode mode. To open the page straight into Unity mode, add `?lang=unity` to the address:
`https://anwhel.github.io/pxt-codeflow/?lang=unity`

## Blocks

When the extension is added to a project, a **Codeflow** toolbox category appears. At the
top is the **Show pseudocode & flowcharts** button, which opens Codeflow inside the editor.
Codeflow reads the project's code but never changes it.

### describe

```blocks
codeflow.describe("make the player jump")
```

Lets a student write, in their own words, what a part of the game should do. The block does
nothing when the game runs. Codeflow shows it in the pseudocode as `PURPOSE:` at that point,
so students can check that their code does what they meant:

```
WHEN A Button Pressed:
    PURPOSE: make the player jump
    IF mySprite is hitting a wall on the Bottom:
        SET mySprite's y velocity TO -150
```

## Putting the page online (GitHub Pages)

The web page lives in `docs/`. On GitHub go to **Settings → Pages**. Set **Source** to
*Deploy from a branch*, choose the branch and the `/docs` folder, then save.
The page will be at `https://anwhel.github.io/pxt-codeflow/`.

A teacher can also link a shared project directly:
`https://anwhel.github.io/pxt-codeflow/?share=https://makecode.com/_abc123`

## Inside the MakeCode editor (editor extension)

This repo is also a MakeCode extension (`pxt.json`, `main.ts`). When it is added to a
project, a **Codeflow** toolbox category gets a **Show pseudocode & flowcharts** button.
That button opens the page inside the editor, and the page reads the project's code with
the editor-extension `extusercode` message, so students skip the copy and paste.

**Limitation:** MakeCode only opens an extension's web page when the MakeCode team has
approved the GitHub repo **and** listed its URL in `approvedEditorExtensionUrls`.
Until then, adding the extension shows "Sorry, this extension is not allowed", so use
the web page instead. To ask for approval, open an issue at
https://github.com/microsoft/pxt-arcade.

## Development

```
npm install
npm test          # converts test/samples (*.ts and *.cs) and checks every flowchart is valid
npm run serve     # serves docs/ at http://localhost:8080
```

- `docs/codeflow.js` is the converter: TypeScript syntax tree → pseudocode lines + Mermaid
  flowcharts. It also works in Node.
  - To change the wording for an API call, edit the `CALLS` phrasebook.
  - To change event headings, edit the `EVENTS` phrasebook.
- `docs/codeflow-csharp.js` is the Unity converter. It reads C# with tree-sitter
  (web-tree-sitter 0.24.7 and tree-sitter-c-sharp 0.23.1, loaded from jsDelivr only when Unity
  is chosen). To change the wording for Unity commands, edit its `CALLS`, `PROPS` and
  `MESSAGES` phrasebooks.
- `docs/app.js` is the page: pasting code, share links, rendering, hover links, export and
  editor-extension messaging.
- The libraries (TypeScript 5.4.5 and Mermaid 11.4.1) load from jsDelivr.

#### Metadata (used for search, rendering)

* for PXT/arcade
