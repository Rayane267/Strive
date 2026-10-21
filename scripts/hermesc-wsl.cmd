@echo off
rem hermesc pour les compilations release Android sur Windows.
rem
rem `hermes-compiler` ne livre hermesc que pour Linux et macOS : sans lui,
rem `bundleRelease` s'arrete sur « Couldn't determine Hermesc location ». Ce
rem relais lance le binaire Linux du meme paquet a travers WSL 2 (meme
rem version, donc meme bytecode que celui que l'app embarque).
rem
rem Branche par android/app/build.gradle, sur Windows seulement. Gradle
rem l'appelle depuis la racine du projet : le chemin du script est relatif.
wsl.exe -e bash scripts/hermesc-wsl.sh %*
exit /b %ERRORLEVEL%
