"""工具闭环测试：list -> write -> read -> exec。"""
from __future__ import annotations

import pytest

from agent_runtime.security.command_policy import CommandPolicy
from agent_runtime.security.path_policy import PathPolicy, PathPolicyError
from agent_runtime.tools import exec_tool, file_tools


@pytest.fixture
def policies(tmp_path):
    pp = PathPolicy([str(tmp_path)])
    cp = CommandPolicy(["python", "echo", "dir"])
    return pp, cp


def test_write_read_list_roundtrip(policies, tmp_path):
    pp, _ = policies
    assert "已写入" in file_tools.write_file(pp, "hello.txt", "hello world\n")
    assert file_tools.read_file(pp, "hello.txt", 1024 * 1024) == "hello world\n"
    listing = file_tools.list_files(pp, ".")
    assert "hello.txt" in listing


def test_exec_echo(policies, tmp_path):
    pp, cp = policies
    out = exec_tool.exec_local_command(cp, pp, "echo hi", 30, ".")
    assert "exit_code: 0" in out
    assert "hi" in out


def test_exec_outside_workdir_rejected(policies, tmp_path):
    pp, cp = policies
    with pytest.raises(PathPolicyError):
        exec_tool.exec_local_command(cp, pp, "echo hi", 30, "..")


def test_read_outside_rejected(policies, tmp_path):
    pp, _ = policies
    with pytest.raises(PathPolicyError):
        file_tools.read_file(pp, "../secret.txt", 1024)


def test_read_over_size_limit_rejected(policies, tmp_path):
    pp, _ = policies
    (tmp_path / "big.txt").write_text("x" * 100, encoding="utf-8")
    out = file_tools.read_file(pp, "big.txt", 10)
    assert "文件过大" in out
