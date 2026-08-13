"""CommandPolicy 命令白名单测试。"""
from __future__ import annotations

import pytest

from agent_runtime.security.command_policy import CommandPolicy, CommandPolicyError


def test_allowed_command_passes():
    cp = CommandPolicy(["python", "dir"])
    argv = cp.validate("python build.py")
    assert argv == ["python", "build.py"]


def test_not_allowed_command_rejected():
    cp = CommandPolicy(["python"])
    with pytest.raises(CommandPolicyError):
        cp.validate("del /q x")


def test_empty_command_rejected():
    cp = CommandPolicy(["python"])
    with pytest.raises(CommandPolicyError):
        cp.validate("")


def test_extension_and_case_normalized():
    cp = CommandPolicy(["python"])
    # 大小写与 .exe 扩展名应等价
    assert cp.validate("PYTHON.EXE --version") == ["PYTHON.EXE", "--version"]
    assert cp.validate("python.exe --version") == ["python.exe", "--version"]


def test_quoted_arguments_split(tmp_path):
    cp = CommandPolicy(["echo"])
    argv = cp.validate('echo "hello world"')
    assert argv[0] == "echo"
    assert "hello world" in argv[1]
