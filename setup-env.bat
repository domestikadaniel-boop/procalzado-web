@echo off
echo ============================================
echo   PROCALZADO - Configuracion de Supabase
echo ============================================
echo.
set /p URL="Pega tu Project URL (https://xxx.supabase.co): "
set /p ANON="Pega tu Publishable Key (sb_publishable_...): "
set /p SECRET="Pega tu Secret Key (sb_secret_...): "

echo PUBLIC_SUPABASE_URL=%URL%> .env
echo PUBLIC_SUPABASE_ANON_KEY=%ANON%>> .env
echo SUPABASE_SERVICE_ROLE_KEY=%SECRET%>> .env

echo.
echo ============================================
echo   .env creado correctamente!
echo ============================================
echo.
echo Ahora ejecuta: npm run dev
pause
