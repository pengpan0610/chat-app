#!/usr/bin/env python3
"""
ChatNova index.html 补丁脚本
在服务器上执行：python3 patch_server.py
"""
import re

FILE = '/var/www/html/chat-app/index.html'

print(f'读取 {FILE} ...')
with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

original_len = len(content)
print(f'文件大小: {original_len} 字符')

# ── 修改 1：handleShot() 函数 ───────────────────────────
old_handleShot = """function handleShot() {
  if (window.__h2cCDNFail || typeof html2canvas === 'undefined') {
    showToast('html2canvas 加载失败，无法截图');
    return;
  }
  showToast('正在准备截图…');
  // 微信风格：先截全屏 → 立刻弹出区域选择遮罩 → 选完直接进标注弹窗
  setTimeout(function() {
    html2canvas(document.body, { backgroundColor: '#0b0f1a', logging: false, useCORS: true, scale: window.devicePixelRatio || 1 }).then(function(canvas) {
      // 截完后存入内存，等待用户在区域选择遮罩上选区
      state._shotFullCanvas = canvas;
      state._shotFullWidth = canvas.width;
      state._shotFullHeight = canvas.height;
      state._shotFullDataUrl = canvas.toDataURL('image/png');
      // 弹出区域选择遮罩
      state.showShotRegion = true;
      state._shotRegion = null;
      render();
      // 初始化区域选择
      setTimeout(initShotRegionSelector, 60);
    }).catch(function(e) {
      console.error(e);
      showToast('截图失败：' + (e.message || e));
    });
  }, 200);
}"""

new_handleShot = """function handleShot() {
  if (window.__h2cCDNFail || typeof html2canvas === 'undefined') {
    showToast('html2canvas 加载失败，无法截图');
    return;
  }
  showToast('正在截图…');
  // 微信风格：先截 #app 区域 → 立刻弹出区域选择遮罩 → 选完直接进标注弹窗
  // 用 Promise.race 加 8 秒超时，避免 html2canvas 卡死永不 reject
  var timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error('截图超时（8秒）')); }, 8000);
  });
  setTimeout(function() {
    var appEl = document.getElementById('app');
    if (!appEl) appEl = document.body;
    var finishPromise = html2canvas(appEl, {
      backgroundColor: '#1a1a2e',
      logging: false,
      useCORS: false,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      onclone: function(clonedDoc) {
        // 隐藏截图遮罩本身，避免截到自己的 UI
        var masks = clonedDoc.querySelectorAll('.modal-bg, .shot-region-bg');
        for (var i = 0; i < masks.length; i++) masks[i].style.display = 'none';
      }
    });
    Promise.race([finishPromise, timeoutPromise]).then(function(canvas) {
      // 截完后存入内存，等待用户在区域选择遮罩上选区
      state._shotFullCanvas = canvas;
      state._shotFullWidth = canvas.width;
      state._shotFullHeight = canvas.height;
      state._shotFullDataUrl = canvas.toDataURL('image/png');
      // 弹出区域选择遮罩
      state.showShotRegion = true;
      state._shotRegion = null;
      render();
      // 初始化区域选择
      setTimeout(initShotRegionSelector, 60);
    }).catch(function(e) {
      console.error('截图失败', e);
      showToast('截图失败：' + (e.message || e));
    });
  }, 100);
}"""

if old_handleShot in content:
    content = content.replace(old_handleShot, new_handleShot, 1)
    print('✅ 修改 1 完成：handleShot() 函数（修复 backgroundColor + 超时机制）')
else:
    print('⚠️  修改 1 跳过：未找到 handleShot() 旧代码（可能已修改过）')

# ── 修改 2：activateShotTool() 函数 ────────────────────────
old_activate = """// 9. 撤销/重做
// 工具按钮统一入口（data-act 触发）：等待 fabric 就绪后激活工具
function activateShotTool(el, tool) {
  if (typeof fabric === 'undefined') {
    showToast('fabric.js 还没加载好，请稍候再点');
    return;
  }
  if (!state._fabricCanvas) {
    showToast('画布还在初始化，请稍等');
    return;
  }
  if (typeof window.setShotTool === 'function') {
    window.setShotTool(tool);
  } else {
    showToast('工具未绑定，请刷新页面');
  }
}"""

new_activate = """// 9. 撤销/重做
// 工具按钮统一入口（data-act 触发）
// 不依赖 window.setShotTool 闭包，直接操作 state._fabricCanvas
function activateShotTool(el, tool) {
  if (typeof fabric === 'undefined') {
    showToast('fabric.js 还没加载好，请稍候再点');
    return;
  }
  var canvas = state._fabricCanvas;
  if (!canvas) {
    showToast('画布还在初始化，请稍等');
    return;
  }
  // 直接设置工具，不依赖闭包
  state._shotTool = tool;
  canvas.isDrawingMode = false;
  canvas.selection = false;
  canvas.defaultCursor = tool ? 'crosshair' : 'default';
  // 高亮对应按钮（用 data-act 选择，不依赖 data-tool）
  document.querySelectorAll('.shot-tool').forEach(function(b) {
    var act = b.dataset.act || '';
    var isThis = false;
    if (tool === 'rect') isThis = act === 'shot-tool-rect';
    else if (tool === 'ellipse') isThis = act === 'shot-tool-ellipse';
    else if (tool === 'arrow') isThis = act === 'shot-tool-arrow';
    else if (tool === 'pen') isThis = act === 'shot-tool-pen';
    else if (tool === 'text') isThis = act === 'shot-tool-text';
    else if (tool === 'mosaic') isThis = act === 'shot-tool-mosaic';
    b.classList.toggle('active', isThis);
  });
  if (tool === 'pen') {
    canvas.isDrawingMode = true;
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = state._shotColor;
      canvas.freeDrawingBrush.width = 3;
    }
  }
  // 确保事件监听器用的是最新的 tool 值
  // 把 tool 存到 canvas 上，事件监听器从 canvas._activeTool 读
  canvas._activeTool = tool;
}"""

if old_activate in content:
    content = content.replace(old_activate, new_activate, 1)
    print('✅ 修改 2 完成：activateShotTool() 函数（不再依赖闭包）')
else:
    print('⚠️  修改 2 跳过：未找到 activateShotTool() 旧代码（可能已修改过）')

# ── 修改 3：bindShotTool() 函数（闭包变量 tool → canvas._activeTool）──
old_bind = """function bindShotTool(canvas, scale) {
  var tool = null;
  var isDown = false, startX, startY, activeObj = null;
  state._shotTool = null;

  function setTool(t) {
    tool = t;
    state._shotTool = t;
    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.defaultCursor = t ? 'crosshair' : 'default';
    canvas.forEachObject(function(o) { o.selectable = false; o.evented = false; });
    document.querySelectorAll('.shot-tool[data-tool]').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tool === t);
    });
    if (t === 'pen') {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.color = state._shotColor;
      canvas.freeDrawingBrush.width = 3;
    }
  }
  window.setShotTool = setTool;"""

new_bind = """function bindShotTool(canvas, scale) {
  var isDown = false, startX, startY, activeObj = null;
  state._shotTool = null;
  canvas._activeTool = null;

  // 兼容旧调用：window.setShotTool 直接更新 canvas._activeTool
  window.setShotTool = function(t) {
    canvas._activeTool = t;
    state._shotTool = t;
    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.defaultCursor = t ? 'crosshair' : 'default';
    canvas.forEachObject(function(o) { o.selectable = false; o.evented = false; });
    // 高亮按钮（用 data-act 选择）
    document.querySelectorAll('.shot-tool').forEach(function(b) {
      var act = b.dataset.act || '';
      var isThis = false;
      if (t === 'rect') isThis = act === 'shot-tool-rect';
      else if (t === 'ellipse') isThis = act === 'shot-tool-ellipse';
      else if (t === 'arrow') isThis = act === 'shot-tool-arrow';
      else if (t === 'pen') isThis = act === 'shot-tool-pen';
      else if (t === 'text') isThis = act === 'shot-tool-text';
      else if (t === 'mosaic') isThis = act === 'shot-tool-mosaic';
      b.classList.toggle('active', isThis);
    });
    if (t === 'pen') {
      canvas.isDrawingMode = true;
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.color = state._shotColor;
        canvas.freeDrawingBrush.width = 3;
      }
    }
  };"""

if old_bind in content:
    content = content.replace(old_bind, new_bind, 1)
    print('✅ 修改 3 完成：bindShotTool() 闭包变量修复（tool → canvas._activeTool）')
else:
    print('⚠️  修改 3 跳过：未找到 bindShotTool() 旧代码（可能已修改过）')
    # 调试：搜索 bindShotTool 函数看看当前内容
    idx = content.find('function bindShotTool')
    if idx >= 0:
        print(f'    （找到 bindShotTool 函数，位置：{idx}）')

# 写回文件
with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

new_len = len(content)
print(f'\n完成！文件大小: {new_len} 字符（变化: {new_len - original_len:+d}）')
print(f'已写入 {FILE}')
print('请硬刷新浏览器测试（Ctrl+Shift+R）')
