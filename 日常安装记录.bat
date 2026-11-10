@echo off
chcp 65001 >nul
echo =========================================
echo   DSH Plugins - 检查并安装依赖
echo =========================================
echo.

call pnpm install
if %errorlevel% neq 0 (
    echo.
    echo ❌ 安装失败，请检查报错信息！
) else (
    echo.
    echo ✅ 依赖已就绪！
)

echo.
pause