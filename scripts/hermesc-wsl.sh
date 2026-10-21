#!/usr/bin/env bash
# Moitié Linux de scripts/hermesc-wsl.cmd.
#
# Gradle passe ses chemins à la façon Windows : relatifs à la racine du projet
# avec des antislashs (`android\app\build\…`), ou absolus (`D:\…`). hermesc
# Linux ne lit ni l'un ni l'autre : on les convertit avant de lui passer la main.
set -e

HERMESC="node_modules/hermes-compiler/hermesc/linux64-bin/hermesc"

args=()
for a in "$@"; do
  case "$a" in
    [A-Za-z]:\\* | [A-Za-z]:/*) args+=("$(wslpath -u "$a")") ;;
    *\\*) args+=("${a//\\//}") ;;
    *) args+=("$a") ;;
  esac
done

exec "$HERMESC" "${args[@]}"
