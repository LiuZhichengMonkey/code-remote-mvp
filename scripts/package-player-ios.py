"""Package a macOS-built iPhone .app with ditto, preserving framework symlinks."""
import hashlib
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path


def package(app: Path, output: Path):
    if app.suffix != '.app' or not app.is_dir():
        raise ValueError('Expected a built .app directory')
    with (app / 'Info.plist').open('rb') as handle:
        info = plistlib.load(handle)
    executable = info.get('CFBundleExecutable', '')
    if not executable or Path(executable).name != executable or not (app / executable).is_file():
        raise ValueError('Missing app executable')
    if info.get('CFBundleSupportedPlatforms') != ['iPhoneOS']:
        raise ValueError('Expected an iPhoneOS build, not a simulator build')
    if list(app.rglob('embedded.mobileprovision')):
        raise ValueError('Unexpected provisioning profile in unsigned kit')
    if output.exists():
        raise ValueError('Output already exists; preserve existing artifacts')
    output.mkdir(parents=True)
    payload = output / 'Payload'
    payload.mkdir()
    shutil.copytree(app, payload / app.name, symlinks=True)
    ipa = output / 'TorrentPlayer-unsigned.ipa'
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(payload), str(ipa)], check=True)
    digest = hashlib.sha256(ipa.read_bytes()).hexdigest()
    (output / 'SHA256SUMS.txt').write_text(f'{digest}  {ipa.name}\n', encoding='utf-8')
    (output / 'SIGNING.txt').write_text(
        'Unsigned iPhone build. Sign with your own Apple development/distribution identity and matching provisioning profile before installing. '
        'This player embeds its BT engine and downloads into iPhone application storage; no computer service is required. '
        'iOS 26 supports user-requested continued background downloads when the system grants execution; older iOS has limited background runtime. '
        'Cancellation or resource limits can stop background work; reopen and resume. Actual background playback uses native audio. '
        'Review included source and dependency notices. '
        'Build success does not prove device playback.\n', encoding='utf-8')
    return ipa


if __name__ == '__main__':
    package(Path(sys.argv[1]), Path(sys.argv[2]))
