@echo off
setlocal
if exist "%~dp0dist\cli.js" goto useLocalCli
set "activeVersionFile=%~dp0..\.active-version"
if not exist "%activeVersionFile%" goto missingVersion
set "activeVersion="
set /p activeVersion=<"%activeVersionFile%"
if not defined activeVersion goto missingVersion
set "cliPath=%~dp0..\%activeVersion%\forge614-shell-%activeVersion%\dist\cli.js"
goto runCli
:missingVersion
>&2 echo Forge614 Shell launcher error: .active-version is missing or empty.
exit /b 1
:useLocalCli
set "cliPath=%~dp0dist\cli.js"
:runCli
@(goto) 2>nul & node "%cliPath%" %* & @exit /b
