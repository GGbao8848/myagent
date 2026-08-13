"""PyInstaller 打包入口脚本。

PyInstaller 需要一个顶层脚本作为入口，这里直接调用包内的 main()。
"""
from agent_runtime.__main__ import main

if __name__ == "__main__":
    main()
