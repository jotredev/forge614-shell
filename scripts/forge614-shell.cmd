@(goto) 2>nul & @echo off &
if exist "%~dp0dist\cli.js" (
  node "%~dp0dist\cli.js" %*
  exit /b
)
set "activeVersionFile=%~dp0..\.active-version"
if not exist "%activeVersionFile%" goto missingVersion
set "activeVersion="
set /p activeVersion=<"%activeVersionFile%"
if not defined activeVersion goto missingVersion
node "%~dp0..\%activeVersion%\forge614-shell-%activeVersion%\dist\cli.js" %*
exit /b %ERRORLEVEL%
:missingVersion
>&2 echo Forge614 Shell launcher error: .active-version is missing or empty.
exit /b 1
