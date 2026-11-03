import json
import os

from config import SYNCED_FILE


def save_synced_data_file_list(file_list: list):
    old_list = load_synced_file_list()

    with open(SYNCED_FILE, "w") as f:
        # Refreshing the latest FIT files must not grow this manifest on
        # every scheduled run, nor mutate the caller's list.
        json.dump(list(dict.fromkeys([*old_list, *file_list])), f)


def load_synced_file_list():
    if os.path.exists(SYNCED_FILE):
        with open(SYNCED_FILE, "r") as f:
            try:
                return json.load(f)
            except Exception as e:  # noqa: BLE001
                print(f"json load {SYNCED_FILE} \nerror {e}")

    return []
