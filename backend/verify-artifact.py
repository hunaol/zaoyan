"""Fail the image build if the application or a nested dependency is damaged."""
import io
import zipfile
from pathlib import Path

path = Path('/app/server.jar')
with zipfile.ZipFile(path) as archive:
    bad = archive.testzip()
    if bad:
        raise ValueError(f'Corrupt application JAR entry: {bad}')
    manifest = archive.read('META-INF/MANIFEST.MF').decode('utf-8')
    manifest = manifest.replace('\r\n', '\n').replace('\n ', '')
    attributes = dict(line.split(': ', 1) for line in manifest.splitlines() if ': ' in line)
    assert attributes.get('Main-Class') == 'org.springframework.boot.loader.launch.JarLauncher'
    assert attributes.get('Start-Class') == 'com.zaoyan.ZaoyanApplication'
    app_class = archive.read('BOOT-INF/classes/com/zaoyan/ZaoyanApplication.class')
    assert app_class[:4] == b'\xca\xfe\xba\xbe', 'Invalid application class'
    libraries = [name for name in archive.namelist()
                 if name.startswith('BOOT-INF/lib/') and name.endswith('.jar')]
    assert libraries, 'Application dependencies are missing'
    for name in libraries:
        with zipfile.ZipFile(io.BytesIO(archive.read(name))) as dependency:
            bad = dependency.testzip()
            if bad:
                raise ValueError(f'Corrupt dependency: {name}: {bad}')
print(f'Application JAR verified: {path.stat().st_size} bytes, {len(libraries)} dependencies')
