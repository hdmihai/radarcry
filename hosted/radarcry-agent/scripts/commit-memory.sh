#!/usr/bin/env bash
# Saves what the assistant changed in memory/ and pushes it, even when another run pushed first.
# Every file is written by one run (a conversation, a case), except index.json, which is rebuilt from
# the files after a conflict, so two runs at once never lose each other's work.
set -euo pipefail
MEM_DIR="${MEM_DIR:?MEM_DIR (checkout-ul repo-ului privat) lipsește}"
CODE_DIR="${CODE_DIR:?CODE_DIR (codul radarcry) lipsește}"
LABEL="${LABEL:-asistent}"
cd "$MEM_DIR"
git config user.name 'asistent-ai'
git config user.email 'asistent-ai@users.noreply.github.com'
git add -A memory
if git diff --cached --quiet; then
  echo 'Nimic de salvat.'
  exit 0
fi
git commit -q -m "asistent: ${LABEL}"
branch="$(git rev-parse --abbrev-ref HEAD)"
for attempt in 1 2 3 4 5 6; do
  if git push -q origin "HEAD:${branch}"; then
    echo "Memoria salvată (încercarea ${attempt})."
    exit 0
  fi
  echo "Alt job a scris între timp; reiau (încercarea ${attempt})."
  git fetch -q origin "${branch}"
  # During a rebase "theirs" is the commit being replayed: our files win, then the index is rebuilt.
  if ! git rebase -q -X theirs "origin/${branch}"; then
    git rebase --abort || true
    git reset -q --hard "origin/${branch}"
    echo 'Rebază imposibilă; operația trebuie reluată.' >&2
    exit 1
  fi
  (cd "$CODE_DIR" && ASSIST_OP=reindex node agent/main.js assist --mem-dir "$MEM_DIR/memory" >/dev/null)
  git add -A memory
  git diff --cached --quiet || git commit -q --amend --no-edit
  sleep $((attempt * 2))
done
echo 'Nu am putut salva memoria după mai multe încercări.' >&2
exit 1
