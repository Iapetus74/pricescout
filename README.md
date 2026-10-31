# PriceScout

PriceScout is a personal web app that compares and tracks prices across South African online stores. It runs on your own computer. The full plan is in [SPEC.md](SPEC.md).

**Where things stand:** milestone 1 (project setup) is done. The app starts and shows a placeholder home page. Price checking, stores and watchlists come in later milestones.

This guide assumes you have never programmed before. Do the steps in order. Each step says what to type and what you should see.

---

## Part 1: One-time setup

You only do this part once per computer.

### Step 1. Open a terminal

A terminal is a window where you type commands instead of clicking.

- **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
- **Windows:** press the Windows key, type `PowerShell`, press Enter.

Every command below is typed into this window, followed by Enter.

### Step 2. Install Node.js

Node.js is the engine that runs the app. You need version 22 or newer.

1. Go to <https://nodejs.org> and download the **LTS** version.
2. Open the downloaded file and click through the installer, keeping the default options.
3. **Close the terminal and open a new one**, so it notices the new install.
4. Check it worked:

   ```
   node -v
   ```

   You should see something like `v22.20.0` or `v24.11.0`. Any number starting with 22 or higher is fine.

   If you see "command not found" or "not recognized", the install didn't finish, or the terminal was opened before installing. Close the terminal, open a new one and try again.

### Step 3. Install Git

Git keeps a history of every change to the project and downloads it from GitHub.

- **Mac:** type `git --version`. If Git isn't installed, your Mac offers to install it. Click **Install** and wait.
- **Windows:** download it from <https://git-scm.com/download/win> and run the installer with the default options. Then open a new terminal.

Check it worked:

```
git --version
```

You should see something like `git version 2.47.0`.

### Step 4. Download the project

This copies the project from GitHub into a folder called `pricescout` in your home folder. Replace `YOUR-GITHUB-NAME` with your GitHub username.

```
cd ~
git clone https://github.com/YOUR-GITHUB-NAME/pricescout.git
```

You should see a few lines ending in `done.`

### Step 5. Go into the project folder

```
cd pricescout
```

Nothing is printed. From now on, always run commands from inside this folder. If you open a new terminal later, run `cd ~/pricescout` first.

### Step 6. Install the project's building blocks

The project uses ready-made pieces of code written by other people (called packages). This command downloads them:

```
npm install
```

It takes a minute or two and prints a summary such as `added 450 packages`. You may see lines that say `npm warn` or mention "vulnerabilities". These are normal and you can ignore them.

### Step 7. Create your settings file

The app reads private settings from a file called `.env`. Start from the example:

- **Mac:** `cp .env.example .env`
- **Windows:** `copy .env.example .env`

Nothing is printed. You don't need to change anything in it yet. Later milestones add email settings here. **Never share or upload your `.env` file.**

---

## Part 2: Running the app

Do this every time you want to use PriceScout.

### Start the app

```
npm run dev
```

You should see `Database is up to date`, then a few lines ending in `✓ Ready`. Leave this terminal open: the app runs for as long as this window stays open.

Now open your web browser and go to <http://localhost:3000>. You should see the PriceScout home page with a "Paste a product link" box. The box doesn't do anything yet.

### Stop the app

Click in the terminal window and press `Ctrl + C`.

---

## Part 3: Checking that everything works

These commands are mainly for checking changes. Run them in the project folder while the app is stopped, or in a second terminal window.

| Command | What it does | What you should see |
|---|---|---|
| `npm test` | Runs the automatic tests | `Tests  26 passed` (the number grows over time) and no red `FAIL` lines |
| `npm run lint` | Checks the code for common mistakes | No error lines |
| `npm run typecheck` | Checks that the code's types fit together | No error lines |

---

## Part 4: Getting updates

When new work has been added on GitHub, download it like this:

```
cd ~/pricescout
git pull
npm install
```

Then start the app as usual with `npm run dev`. Database updates are applied automatically when the app starts.

---

## If something goes wrong

- **"command not found: npm" or "npm is not recognized":** Node.js isn't installed, or the terminal was opened before you installed it. Do Step 2 again, then open a new terminal.
- **"Port 3000 is in use":** the app is already running in another terminal window. Use that one, or stop it there with `Ctrl + C`.
- **Errors during `npm install` that mention "better-sqlite3" or "gyp":** the database package couldn't set itself up. Make sure your Node.js version is 22 or newer (`node -v`), then run `npm install` again.
- **The page in the browser says "This site can't be reached":** the app isn't running. Start it with `npm run dev` and wait for `✓ Ready`.

---

## For reference: what's inside

| Where | What |
|---|---|
| `src/app/` | The web pages |
| `src/components/ui/` | Ready-made buttons, cards and input boxes (shadcn/ui) |
| `src/db/schema.ts` | The database tables (see SPEC.md section 10) |
| `src/db/migrations/` | Step-by-step instructions for building the database tables |
| `src/lib/money.ts` | Turns prices like "R 1 299,99" into cents and back |
| `data/pricescout.db` | Your database file, created the first time you start the app. It isn't uploaded to GitHub. |
| `SPEC.md` | What the app will do |
| `CLAUDE.md` | Working rules for Claude |

All prices are stored as whole cents (R 1 299,99 is stored as 129999), so totals never pick up rounding errors.

Built with TypeScript, Next.js, Tailwind CSS, shadcn/ui, SQLite, Drizzle ORM and Vitest.
