import subprocess


def capture(path):
    subprocess.run(
        ["spectacle", "-b", "-n", "-f", "-o", path],
        check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return path
