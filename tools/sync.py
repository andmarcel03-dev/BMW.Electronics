#!/usr/bin/env python3
"""Sync the curated MGU Store apps into this repository.

Reads sources.json, clones each listed GitHub repo (shallow), copies its tree into
vendor/<name>/, and merges every source's mgu-repo.json into one mgu-repo.json at
the root, with all paths prefixed by vendor/<name>/.

Usage:  python3 tools/sync.py            (from the repository root)
"""
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
VENDOR = os.path.join(ROOT, 'vendor')
SKIP = {'.git', '.github', 'dist', 'oap-sdk', 'node_modules', '__pycache__'}


def prefix(p, pre):
    return p if p.startswith('/') or '://' in p else f'{pre}/{p}'


def prefix_build(build, pre):
    if not isinstance(build, dict):
        return build  # "unit"
    b = dict(build)
    for k in ('python', 'node', 'sdk', 'output'):
        if k in b and isinstance(b[k], str):
            b[k] = prefix(b[k], pre)
    if isinstance(b.get('shared'), list):
        b['shared'] = [prefix(s, pre) for s in b['shared']]
    return b


def expand_apps_folder(src_dir, folder):
    """Turn an "apps": {"path": "apps/*", "manifest": ...} block into component entries."""
    pattern = folder['path']
    manifest = folder.get('manifest', 'app.json')
    exclude = set(folder.get('exclude', []))
    base = pattern.split('*')[0].rstrip('/')
    out = []
    for name in sorted(os.listdir(os.path.join(src_dir, base))):
        rel = f'{base}/{name}'
        mf = os.path.join(src_dir, rel, manifest)
        if name in exclude or not fnmatch.fnmatch(rel, pattern) or not os.path.isfile(mf):
            continue
        with open(mf) as f:
            m = json.load(f)
        entry = {'id': m.get('id', name), 'kind': 'app', 'path': rel}
        for k in ('title', 'description'):
            if k in m:
                entry[k] = m[k]
        for k in ('build', 'requires', 'optional', 'uninstallable', 'mguHmi'):
            if k in folder:
                entry[k] = folder[k]
        out.append(entry)
    return out


def main():
    with open(os.path.join(ROOT, 'sources.json')) as f:
        sources = json.load(f)['sources']

    merged, seen, lock = [], {}, {}
    os.makedirs(VENDOR, exist_ok=True)
    for s in sources:
        name, repo, branch = s['name'], s['repo'], s.get('branch', 'main')
        include = set(s.get('include', []))
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['git', 'clone', '--depth', '1', '--branch', branch,
                            f'https://github.com/{repo}', tmp], check=True)
            commit = subprocess.run(['git', '-C', tmp, 'rev-parse', 'HEAD'], check=True,
                                    capture_output=True, text=True).stdout.strip()
            with open(os.path.join(tmp, 'mgu-repo.json')) as f:
                manifest = json.load(f)
            comps = list(manifest.get('components', []))
            if isinstance(manifest.get('apps'), dict):
                comps += expand_apps_folder(tmp, manifest['apps'])

            dest = os.path.join(VENDOR, name)
            shutil.rmtree(dest, ignore_errors=True)
            shutil.copytree(tmp, dest, ignore=lambda d, names: [n for n in names if n in SKIP])
            os.remove(os.path.join(dest, 'mgu-repo.json'))

        pre = f'vendor/{name}'
        for c in comps:
            if include and c['id'] not in include:
                continue
            if c['id'] in seen:
                print(f"skip duplicate id {c['id']} from {repo} (already from {seen[c['id']]})", file=sys.stderr)
                continue
            c = dict(c)
            c['path'] = prefix(c['path'], pre)
            if 'build' in c:
                c['build'] = prefix_build(c['build'], pre)
            merged.append(c)
            seen[c['id']] = repo
        lock[name] = {'repo': repo, 'branch': branch, 'commit': commit}
        print(f'{repo}@{commit[:7]} -> {pre}')

    with open(os.path.join(ROOT, 'mgu-repo.json'), 'w') as f:
        json.dump({'schema': 1, 'components': merged}, f, ensure_ascii=False, indent=2)
        f.write('\n')
    with open(os.path.join(ROOT, 'sources.lock.json'), 'w') as f:
        json.dump(lock, f, indent=2)
        f.write('\n')
    print(f'{len(merged)} components in mgu-repo.json')


if __name__ == '__main__':
    main()
