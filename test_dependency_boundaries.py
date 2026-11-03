"""The public sync and CI install must not need the private image API client."""

import re
import tomllib
from pathlib import Path


def test_ai_image_client_is_an_explicit_opt_in():
    project = tomllib.loads(Path("pyproject.toml").read_text())
    normal = project["project"]["dependencies"]
    share = project["project"]["optional-dependencies"]["share"]
    sync_requirements = Path("requirements.txt").read_text().splitlines()

    def is_openai(dep: str) -> bool:
        return (
            re.match(r"openai(?:$|[<=>!~;\[])", dep.strip(), re.IGNORECASE) is not None
        )

    assert not any(is_openai(dep) for dep in normal)
    assert any(dep.lower().startswith("openai") for dep in share)
    assert not any(
        line.strip().lower().startswith("openai") for line in sync_requirements
    )
