#!/usr/bin/env bash
# Download UN WPP 2024 CSVs into data/raw/wpp with resume + retries (the UN server is slow and drops connections).
set -u
cd "$(dirname "$0")/../raw" && mkdir -p wpp && cd wpp
B="https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES"
FILES=(
  WPP2024_Demographic_Indicators_Medium.csv.gz
  WPP2024_Life_Table_Complete_Medium_Female_1950-2023.csv.gz
  WPP2024_Life_Table_Complete_Medium_Male_1950-2023.csv.gz
)
for f in "${FILES[@]}"; do
  want=$(curl -sIL -m 60 "$B/$f" | grep -i '^content-length' | tail -1 | tr -dc '0-9')
  for try in $(seq 1 50); do
    have=$(stat -c %s "$f" 2>/dev/null || echo 0)
    [ -n "$want" ] && [ "$have" -ge "$want" ] && break
    curl -sSL -C - --speed-limit 1000 --speed-time 60 -o "$f" "$B/$f" || sleep 5
  done
  echo "$f $(stat -c %s "$f")/$want"
done
