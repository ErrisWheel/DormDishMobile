import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = { ...process.env };
const runningProcesses = new Set();
let shuttingDown = false;

function startProcess(executable, args, options = {}) {
    const child = spawn(executable, args, {
        cwd: root,
        env: environment,
        stdio: options.stdio || 'inherit',
        windowsHide: options.windowsHide ?? true,
        detached: options.detached ?? false
    });

    if (!options.detached) {
        runningProcesses.add(child);
        child.once('exit', () => runningProcesses.delete(child));
    }

    return child;
}

function findSdkDirectory() {
    const candidates = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
        path.join(os.homedir(), 'Library', 'Android', 'sdk'),
        path.join(os.homedir(), 'Android', 'Sdk')
    ].filter(Boolean);

    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function sdkTool(sdkDirectory, toolName) {
    const executableName = process.platform === 'win32' ? `${toolName}.exe` : toolName;
    const candidate = sdkDirectory ? path.join(sdkDirectory, toolName === 'adb' ? 'platform-tools' : 'emulator', executableName) : '';

    if (candidate && fs.existsSync(candidate)) {
        return candidate;
    }

    const command = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(command, [executableName], { encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean)?.trim() || '' : '';
}

function runTool(executable, args) {
    if (!executable) {
        return '';
    }

    const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    return result.status === 0 ? result.stdout.trim() : '';
}

function connectedDevice(adb) {
    const result = runTool(adb, ['devices']);
    const devices = result.split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => /\sdevice$/.test(line));
    return devices.find((line) => line.startsWith('emulator-'))?.split(/\s+/)[0] || devices[0]?.split(/\s+/)[0] || '';
}

async function waitForUrl(url, name, timeoutMs = 90000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs && !shuttingDown) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1800) });
            if (response.ok) {
                console.log(`${name} is ready at ${url}`);
                return true;
            }
        } catch {
        }

        await delay(500);
    }

    return false;
}

async function waitForDevice(adb, timeoutMs = 180000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs && !shuttingDown) {
        const device = connectedDevice(adb);
        if (device) {
            const bootStatus = runTool(adb, ['-s', device, 'shell', 'getprop', 'sys.boot_completed']);
            if (bootStatus === '1') {
                return device;
            }
        }

        await delay(1500);
    }

    return '';
}

async function launchAndroidApp(adb, emulator) {
    let device = connectedDevice(adb);

    if (!device && emulator) {
        const avds = runTool(emulator, ['-list-avds']).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        if (avds.length) {
            console.log(`Starting Android emulator: ${avds[0]}`);
            const emulatorProcess = startProcess(emulator, ['-avd', avds[0]], { stdio: 'ignore', detached: true });
            emulatorProcess.unref();
            device = await waitForDevice(adb);
        }
    }

    if (!device) {
        console.error('No ready Android emulator was found. Start a virtual phone in Android Studio Device Manager. The web preview remains available at http://localhost:5173.');
        console.error('After starting the emulator, run "npm run dev:android" in another terminal while the API and Vite server are running.');
        return;
    }

    console.log(`Launching DormDish on ${device} using the Vite development server.`);
    const capacitorCli = path.join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
    const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(capacitorCli) || !fs.existsSync(viteCli)) {
        console.error('Project dependencies were not found. Run npm install in the DormDishMobile root folder first.');
        return;
    }

    console.log('Preparing the Android project for live-reload debugging.');
    const build = spawnSync(process.execPath, [viteCli, 'build'], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    if (build.status !== 0) {
        console.error('The frontend build failed, so Android launch was skipped. The Vite browser preview remains available.');
        return;
    }

    await new Promise((resolve) => {
        const child = startProcess(process.execPath, [capacitorCli, 'run', 'android', '--config', 'capacitor.config.dev.json', '--target', device]);
        child.once('error', (error) => {
            console.error(`Unable to start Capacitor: ${error.message}`);
            resolve();
        });
        child.once('exit', (code) => {
            if (code !== 0 && !shuttingDown) {
                console.error('Android launch did not complete. The API and Vite server remain available for browser testing.');
            }
            resolve();
        });
    });
}

function shutdown() {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    for (const child of runningProcesses) {
        if (!child.killed) {
            child.kill('SIGTERM');
        }
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const serverProcess = startProcess(process.execPath, ['server/index.js']);
const frontendProcess = startProcess(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', '5173', '--strictPort']);

serverProcess.once('exit', (code) => {
    if (code && !shuttingDown) {
        console.error(`DormDish API exited with code ${code}.`);
    }
});

frontendProcess.once('exit', (code) => {
    if (code && !shuttingDown) {
        console.error(`Vite exited with code ${code}.`);
    }
});

const [frontendReady, apiReady] = await Promise.all([
    waitForUrl('http://localhost:5173', 'Vite'),
    waitForUrl('http://localhost:4000/api/health', 'DormDish API')
]);

if (!frontendReady || !apiReady) {
    console.error('DormDish did not finish starting. Review the API and Vite terminal output above.');
} else {
    const sdkDirectory = findSdkDirectory();
    const adb = sdkTool(sdkDirectory, 'adb');
    const emulator = sdkTool(sdkDirectory, 'emulator');

    if (!adb) {
        console.error('Android SDK platform-tools could not be found. The browser preview remains available at http://localhost:5173.');
        console.error('Install Android SDK Platform-Tools in Android Studio and set ANDROID_HOME or ANDROID_SDK_ROOT to your SDK folder.');
    } else {
        await launchAndroidApp(adb, emulator);
    }
}

console.log('DormDish development servers remain active. Open http://localhost:5173 in a browser, or press Ctrl+C to stop all servers.');
