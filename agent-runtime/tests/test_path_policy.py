"""PathPolicy 目录白名单测试。"""
from __future__ import annotations

import os

import pytest

from agent_runtime.security.path_policy import PathPolicy, PathPolicyError


def test_relative_path_resolves_to_base(tmp_path):
    pp = PathPolicy([str(tmp_path)])
    resolved = pp.resolve(".")
    assert os.path.normcase(resolved) == os.path.normcase(str(tmp_path))


def test_relative_file_within_dir(tmp_path):
    pp = PathPolicy([str(tmp_path)])
    (tmp_path / "a.txt").write_text("x", encoding="utf-8")
    resolved = pp.resolve("a.txt")
    assert os.path.normcase(resolved) == os.path.normcase(str(tmp_path / "a.txt"))


def test_parent_traversal_rejected(tmp_path):
    pp = PathPolicy([str(tmp_path)])
    with pytest.raises(PathPolicyError):
        pp.resolve("../outside.txt")


def test_absolute_outside_rejected(tmp_path):
    pp = PathPolicy([str(tmp_path)])
    with pytest.raises(PathPolicyError):
        pp.resolve(str(tmp_path) + "_outside")


def test_windows_system_dir_rejected(tmp_path):
    pp = PathPolicy([str(tmp_path)])
    with pytest.raises(PathPolicyError):
        pp.resolve(r"C:\Windows")


def test_is_allowed_prefix_boundary(tmp_path):
    # 保证不会因前缀误判：/data 不应当包含 /database
    allowed = tmp_path / "data"
    allowed.mkdir()
    other = tmp_path / "database"
    other.mkdir()
    pp = PathPolicy([str(allowed)])
    assert pp.is_allowed(str(allowed))
    assert not pp.is_allowed(str(other))


def test_symlink_escape_rejected(tmp_path):
    outside = tmp_path.parent / ("outside_" + tmp_path.name)
    outside.mkdir(exist_ok=True)
    (outside / "secret.txt").write_text("secret", encoding="utf-8")
    link = tmp_path / "evil"
    try:
        os.symlink(outside, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlink 不可用（需要开发者模式或管理员权限）")
    pp = PathPolicy([str(tmp_path)])
    with pytest.raises(PathPolicyError):
        pp.resolve(str(link / "secret.txt"))
