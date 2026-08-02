const fs = require('fs');
const path = require('path');

function loadSecrets() {
    const secrets = {};
    const candidates = [
        path.join(__dirname, '..', '..', 'config', 'secrets.bat'),
        path.join(__dirname, '..', '..', 'config', 'secrets.env')
    ];

    let file = candidates.find(f => fs.existsSync(f));
    if (!file) return secrets;

    const text = fs.readFileSync(file, 'utf-8');
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        // set "KEY=VALUE"
        if (trimmed.startsWith('set "') && trimmed.includes('=')) {
            let kv = trimmed.slice(5);
            if (kv.endsWith('"')) kv = kv.slice(0, -1);
            const eq = kv.indexOf('=');
            if (eq > 0) {
                secrets[kv.slice(0, eq)] = kv.slice(eq + 1);
            }
        }
    }
    return secrets;
}

function loadAccounts() {
    const secrets = loadSecrets();
    const accounts = [];
    for (let i = 1; i <= 20; i++) {
        const user = secrets[`GH${i}_USER`];
        const token = secrets[`GH${i}_TOKEN`];
        const repo = secrets[`GH${i}_REPO`];
        const wfId = secrets[`GH${i}_WORKFLOW_ID`];
        if (user && token && wfId) {
            accounts.push({ id: i, user, repo, token, workflow_id: wfId });
        }
    }
    return accounts;
}

module.exports = { loadSecrets, loadAccounts };