import json
import re

def standardize_link(url: str) -> str:
    """
    Standardize testbook.com links to format:
    https://testbook.com/TS-ssc-cgl/tests/<id>/analysis?attemptNo=1
    """
    match = re.search(r"(https://testbook\.com/TS-ssc-cgl/tests/[\w\d]+)", url)
    if match:
        return match.group(1) + "/analysis?attemptNo=1"
    return url  # if it doesn't match, return unchanged

def main():
    input_file = "../links.json"
    output_file = "../links_cleaned.json"

    # Load JSON
    with open(input_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Clean links
    for entry in data:
        entry["Link"] = standardize_link(entry["Link"])

    # Save cleaned JSON
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"✅ Links cleaned and saved to {output_file}")

if __name__ == "__main__":
    main()
