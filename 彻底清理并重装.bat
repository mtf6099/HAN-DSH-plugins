@echo off
chcp 65001 >nul
echo =========================================
echo   DSH Plugins - 彻底清理并重装依赖
echo =========================================
echo.

echo [1/2] 正在清理所有的 node_modules...
:: 清理根目录
if exist "node_modules" (
    echo 正在清理 根目录 node_modules...
    rmdir /s /q "node_modules"
)

:: 清理 packages 下所有插件的 node_modules
for /d %%i in (packages\*) do (
    if exist "%%i\node_modules" (
        echo 正在清理 %%i\node_modules...
        rmdir /s /q "%%i\node_modules"
    )
)

echo.
echo [2/2] 正在重新安装依赖...
call pnpm install
if %errorlevel% neq 0 (
    echo.
    echo ❌ 安装失败，请检查报错信息！
) else (
    echo.
    echo ✅ 环境已彻底重置完成！
)

echo.
pause