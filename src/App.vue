<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import {io} from 'socket.io-client'

const roomId = '001'

// 响应式数据
const called=ref(false) //是否是接收方
const caller=ref(false) //是否是发起方
const calling=ref(false)  //呼叫中
const communicating=ref(false)  //视频通话中
const localVideo=ref<HTMLVideoElement | null>(null)  //video标签实例，播放本人的视频
const remoteVideo=ref<HTMLVideoElement | null>(null) //video标签实例，播放对方的视频
const localStream=ref(false) //本地视频流
const remoteStream=ref(false) //对方视频流
const isAnswer=ref(false) //接听视频
const peer=ref(null)
const candidateQueue=ref([]) // 缓存未处理的candidate

const socket = ref(null)

// 计算属性
const isCallActive = computed(() => communicating.value)
const isIncomingCall = computed(() => called.value && calling.value)

// 处理candidate队列的函数
const processCandidateQueue = async () => {
  if (!peer.value) {
    console.warn("⚠️ peer连接不存在，无法处理candidate队列")
    return
  }

  if (!peer.value.remoteDescription) {
    console.warn("⚠️ 远程描述未设置，无法处理candidate队列")
    return
  }

  console.log(`🔄 处理candidate队列，当前队列长度: ${candidateQueue.value.length}`)

  let processedCount = 0
  while (candidateQueue.value.length > 0) {
    const candidate = candidateQueue.value.shift()
    try {
      await peer.value.addIceCandidate(candidate)
      console.log(`✅ 成功添加candidate ${++processedCount}:`, candidate)
    } catch (error) {
      console.error(`❌ 添加candidate失败 (${processedCount + 1}):`, error)
      // 如果添加失败，将candidate放回队列
      candidateQueue.value.unshift(candidate)
      break
    }
  }

  console.log(`🎯 candidate队列处理完成，成功处理: ${processedCount} 个，剩余: ${candidateQueue.value.length} 个`)
}

// 设置远程视频流的辅助函数
const setRemoteVideoStream = async (stream) => {
  if (!stream) {
    console.warn("⚠️ 收到空的视频流，忽略");
    return;
  }

  // 使用 nextTick 确保 DOM 已渲染
  let videoElement = document.querySelector('.local-cideo video') ||
      document.querySelector('video[ref="localVideo"]') ||
      document.querySelector('video');
  // 使用找到的video元素
  if (videoElement) {
    // 清除之前的流
    if (videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(track => track.stop());
    }

    videoElement.srcObject = stream
    remoteStream.value = stream

    // 添加事件监听器
    videoElement.onloadedmetadata = () => {
      console.log("✅ 视频元数据已加载");
      console.log("视频尺寸:", videoElement.videoWidth, "x", videoElement.videoHeight);
    };

    videoElement.oncanplay = () => {
      console.log("✅ 视频可以播放");
    };

    videoElement.onplay = () => {
      console.log("✅ 视频开始播放");
    };

    videoElement.onerror = (e) => {
      console.error("❌ 视频播放错误:", e);
    };

    // 等待DOM更新
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      await videoElement.play()
      console.log('本地视频流已启动')
      // 视频播放成功，记录日志
      console.log("✅ 本地视频流播放成功");
    } catch (playError) {
      console.error('视频播放失败:', playError);
      // 尝试手动触发播放
      videoElement.load();
      await videoElement.play();
    }
    return stream

  } else {
    console.error('videoElement 为 null，无法设置视频流');
  }
}

// 添加candidate到队列或直接处理
const addCandidateSafely = async (candidate) => {
  if (!candidate) {
    console.warn("⚠️ 收到空的candidate，忽略")
    return
  }

  if (!peer.value) {
    console.log("📦 peer连接不存在，将candidate加入队列")
    candidateQueue.value.push(candidate)
    return
  }

  // 检查是否已设置远程描述
  if (peer.value.remoteDescription) {
    try {
      await peer.value.addIceCandidate(candidate)
      console.log("✅ 直接添加candidate成功:", candidate)
    } catch (error) {
      console.error("❌ 直接添加candidate失败，加入队列:", error)
      console.log("📦 将失败的candidate加入队列，等待重试")
      candidateQueue.value.push(candidate)
    }
  } else {
    console.log("📦 远程描述未设置，将candidate加入队列")
    candidateQueue.value.push(candidate)
  }
}

// Vue组件挂载时执行的初始化函数
onMounted(() => {
  console.log('WebRTC视频通话页面已加载')

  const sock = io()

  sock.on('connectionSuccess',()=>{
    console.log('连接成功')
    //向服务器发送一个加入房间的事件
    sock.emit('joinRoom',roomId)
  })
  sock.on('callRemote',()=>{
    console.log("🚀 ~  ~ 拨通接听方:");
    //接听方
    if(!caller.value){
      called.value=true
      calling.value=true
    }
  })
  //接收方同意视频通话
  sock.on('acceptCall',async()=>{
    //发送方收到接收方同意视频请求
    if(caller.value){
      // 配置 ICE 服务器
      peer.value=new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      })
      peer.value.addStream(localStream.value)

      // 通过监听onicecandidate事件获取candidate信息
      peer.value.onicecandidate=(event)=>{
        if(event.candidate){
          console.log("🔍 发送方生成candidate:", event.candidate.type, event.candidate.protocol)
          socket.value?.emit('sendCandidate',{roomId,candidate:event.candidate})
        }
      }

      // 监听连接状态变化
      peer.value.oniceconnectionstatechange = () => {
        console.log("🔗 发送方ICE连接状态:", peer.value.iceConnectionState)
      }

      peer.value.onaddstream=(event)=>{
        console.log("🚀 ~ 发送方收到接收方的stream: ", event);
        setRemoteVideoStream(event.stream);
        communicating.value=true
      }

      // 生成offer
      const offer=await peer.value.createOffer({
        offerToReceiveAudio:1,
        offerToReceiveVideo:1
      })
      // 在本地设置offer信息
      await peer.value.setLocalDescription(offer)
      console.log("🚀 ~  ~ 发送方生成offer: ", offer);
      socket.value?.emit('sendOffer',{offer,roomId})
    }
  })
  // 接受方收到offer
  sock.on('sendOffer',async (offer)=>{
    console.log("🚀 ~  ~ 接收方收到offer: ", offer);
    if(called.value){
      // 配置 ICE 服务器
      peer.value=new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      })
      const stream=await getLocalStream()
      peer.value.addStream(stream)

      // 通过监听onicecandidate事件获取candidate信息
      peer.value.onicecandidate=(event)=>{
        if(event.candidate){
          console.log("🔍 接收方生成candidate:", event.candidate.type, event.candidate.protocol)
          socket.value?.emit('sendCandidate',{roomId,candidate:event.candidate})
        }
      }

      // 监听连接状态变化
      peer.value.oniceconnectionstatechange = () => {
        console.log("🔗 接收方ICE连接状态:", peer.value.iceConnectionState)
      }

      peer.value.onaddstream=(event)=>{
        console.log("🚀 ~ 接受方收到发送方的stream: ", event);
        setRemoteVideoStream(event.stream);
        communicating.value=true
      }

      // 设置远端（发起方）的描述信息SDP
      await peer.value.setRemoteDescription(offer)
      // 设置远程描述后，处理candidate队列
      await processCandidateQueue()
      // 生成并发送answer
      const answer=await peer.value.createAnswer()
      console.log("🚀 ~  ~ 接收方生成answer: ", answer);
      await peer.value.setLocalDescription(answer)
      // 发送answer
      socket.value?.emit('sendAnswer',{answer,roomId})
    }
  })
  //发送方收到answer
  sock.on('sendAnswer',async (answer)=>{
      if(caller.value){
        console.log("🚀 ~ 发送方收到answer: ", answer);
        await peer.value.setRemoteDescription(answer)
        // 设置远程描述后，处理candidate队列
        await processCandidateQueue()
      }
  })
  // 收到candidate信息
  sock.on('sendCandidate',async (candidate)=>{
    console.log("🚀 ~  ~ 收到candidate: ", candidate);
    await addCandidateSafely(candidate)
  })
  // 挂断视频
  sock.on('rejectCall',()=>{
    console.log("📴 收到对方挂断视频的通知")
    endCall()
  })
  socket.value=sock
})

//发起方发起视频
const callRemote= async ()=>{
  console.log("🚀 ~ startCall ~ 发起视频: ");
  caller.value=true
  calling.value=true

  //通过信令服务器向用户B发起视频请求
  socket.value?.emit('callRemote',roomId)

  // 获取本地视频流
  const stream = await getLocalStream()
  localStream.value = stream
}

// 接受方接听视频
const acceptCall=()=>{
  isAnswer.value=true
  socket.value?.emit('acceptCall',roomId)
}

// 挂断视频通话的通用方法
const endCall = () => {
  console.log("📴 挂断视频通话")

  // 停止本地视频流
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => track.stop())
    localStream.value = false
  }

  // 停止远程视频流
  if (remoteStream.value) {
    remoteStream.value.getTracks().forEach(track => track.stop())
    remoteStream.value = false
  }

  // 关闭peer连接
  if (peer.value) {
    peer.value.close()
    peer.value = null
  }

  // 重置状态
  caller.value = false
  called.value = false
  calling.value = false
  communicating.value = false
  isAnswer.value = false

  // 清空candidate队列
  candidateQueue.value = []

  console.log("✅ 视频通话已结束，所有资源已清理")
}

// 主动挂断视频
const rejectCall = () => {
  console.log("📴 主动挂断视频通话")

  // 通知对方挂断
  socket.value?.emit('rejectCall', roomId)
}


const getLocalStream = async () => {
  try {
    // 检查浏览器是否支持getUserMedia
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('您的浏览器不支持摄像头和麦克风访问')
    }

    // 直接通过DOM查询获取video元素
    let videoElement = document.querySelector('.local-video video') ||
                      document.querySelector('video[ref="localVideo"]') ||
                      document.querySelector('video');

    if (!videoElement) {
      throw new Error('DOM元素未挂载，无法设置视频流');
    }

    // 请求媒体权限
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    })

    // 使用找到的video元素
    if (videoElement) {
      // 清除之前的流
      if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
      }

      videoElement.srcObject = stream
      localStream.value = stream // 保存流到状态变量

      // 添加事件监听器
      videoElement.onloadedmetadata = () => {
        console.log("✅ 视频元数据已加载");
        console.log("视频尺寸:", videoElement.videoWidth, "x", videoElement.videoHeight);
      };

      videoElement.oncanplay = () => {
        console.log("✅ 视频可以播放");
      };

      videoElement.onplay = () => {
        console.log("✅ 视频开始播放");
      };

      videoElement.onerror = (e) => {
        console.error("❌ 视频播放错误:", e);
      };

      // 等待DOM更新
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        await videoElement.play()
        console.log('本地视频流已启动')
        // 视频播放成功，记录日志
        console.log("✅ 本地视频流播放成功");
      } catch (playError) {
        console.error('视频播放失败:', playError);
        // 尝试手动触发播放
        videoElement.load();
        await videoElement.play();
      }
      return stream

    } else {
      console.error('videoElement 为 null，无法设置视频流');
    }
  } catch (error) {
    console.error('获取本地媒体流失败:', error)

    // 根据错误类型给出不同的提示
    if (error.name === 'NotAllowedError') {
      alert('请允许访问摄像头和麦克风，然后刷新页面重试')
    } else if (error.name === 'NotFoundError') {
      alert('未找到摄像头或麦克风设备')
    } else if (error.name === 'NotSupportedError') {
      alert('您的浏览器不支持视频通话功能')
    } else {
      alert('获取媒体设备失败: ' + error.message)
    }
  }
}

</script>

<template>
  <div class="webrtc-container">
    <div class="header">
      <h1>WebRTC 视频通话</h1>
      <div class="status">
        <span :class="['status-indicator', { active: communicating }]">
          {{ communicating ? '通话中' : '待机' }}
        </span>
      </div>
    </div>

    <div class="video-container">
      <!-- 远程视频 -->
      <div class="video-wrapper remote-video">
        <video
          ref="remoteVideo"
          autoplay
          playsinline
          class="video-element"
          :class="{ hidden: !remoteStream }"
        ></video>
        <div v-if="!remoteStream" class="video-placeholder">
          <div class="placeholder-icon">📹</div>
          <p>等待对方加入...</p>
        </div>
      </div>

      <!-- 本地视频 -->
      <div class="video-wrapper local-video">
        <video
          ref="localVideo"
          autoplay
          muted
          playsinline
          class="video-element"
          :class="{ hidden: !localStream }"
        ></video>
        <div v-if="!localStream" class="video-placeholder">
          <div class="placeholder-icon">👤</div>
          <p>本地视频</p>
        </div>
      </div>
    </div>

    <!-- 控制按钮 -->
    <div class="controls">
      <button
        @click="callRemote"
        :disabled="isCallActive || isIncomingCall"
        class="btn btn-primary"
      >
        <span class="btn-icon">📞</span>
        发起视频
      </button>

      <button
        @click="rejectCall"
        :disabled="!isCallActive"
        class="btn btn-danger"
      >
        <span class="btn-icon">📴</span>
        挂断视频
      </button>

    </div>

    <!-- 来电提示 -->
    <div v-if="called&&!isAnswer" class="incoming-call-overlay">
      <div class="incoming-call-modal">
        <div class="caller-info">
          <div class="caller-avatar">👤</div>
          <h3>来电中...</h3>
          <p>有人想要与您视频通话</p>
        </div>
        <div class="incoming-call-controls">
          <button @click="acceptCall" class="btn btn-success">
            <span class="btn-icon">✅</span>
            接听
          </button>
          <button @click="rejectCall" class="btn btn-danger">
            <span class="btn-icon">❌</span>
            拒绝
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.webrtc-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  color: white;
}

.header {
  text-align: center;
  margin-bottom: 30px;
}

.header h1 {
  margin: 0 0 10px 0;
  font-size: 2.5rem;
  font-weight: 300;
  text-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

.status {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}

.status-indicator {
  padding: 8px 16px;
  border-radius: 20px;
  background: rgba(255,255,255,0.2);
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.3s ease;
}

.status-indicator.active {
  background: #4CAF50;
  box-shadow: 0 0 20px rgba(76, 175, 80, 0.5);
}

.video-container {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 20px;
  margin-bottom: 30px;
  height: 400px;
}

.video-wrapper {
  position: relative;
  border-radius: 15px;
  overflow: hidden;
  background: rgba(0,0,0,0.3);
  border: 2px solid rgba(255,255,255,0.2);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}

.remote-video {
  grid-column: 1;
}

.local-video {
  grid-column: 2;
  height: 200px;
  align-self: start;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
}

.video-element.hidden {
  opacity: 0;
}

.video-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(0,0,0,0.5);
}

.placeholder-icon {
  font-size: 3rem;
  margin-bottom: 10px;
  opacity: 0.7;
}

.video-placeholder p {
  margin: 0;
  font-size: 1rem;
  opacity: 0.8;
}

.controls {
  display: flex;
  justify-content: center;
  gap: 20px;
  flex-wrap: wrap;
}

.btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border: none;
  border-radius: 25px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 120px;
  justify-content: center;
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

.btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0,0,0,0.3);
}

.btn-primary {
  background: linear-gradient(45deg, #4CAF50, #45a049);
  color: white;
}

.btn-danger {
  background: linear-gradient(45deg, #f44336, #da190b);
  color: white;
}

.btn-warning {
  background: linear-gradient(45deg, #ff9800, #f57c00);
  color: white;
}

.btn-success {
  background: linear-gradient(45deg, #4CAF50, #45a049);
  color: white;
}

.btn-secondary {
  background: linear-gradient(45deg, #607d8b, #455a64);
  color: white;
}

.btn-icon {
  font-size: 1.2rem;
}

.incoming-call-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  animation: fadeIn 0.3s ease;
}

.incoming-call-modal {
  background: white;
  color: #333;
  padding: 40px;
  border-radius: 20px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  animation: slideIn 0.3s ease;
}

.caller-info {
  margin-bottom: 30px;
}

.caller-avatar {
  font-size: 4rem;
  margin-bottom: 15px;
}

.caller-info h3 {
  margin: 0 0 10px 0;
  font-size: 1.5rem;
  color: #333;
}

.caller-info p {
  margin: 0;
  color: #666;
  font-size: 1rem;
}

.incoming-call-controls {
  display: flex;
  gap: 20px;
  justify-content: center;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-50px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .webrtc-container {
    padding: 15px;
  }

  .header h1 {
    font-size: 2rem;
  }

  .video-container {
    grid-template-columns: 1fr;
    height: auto;
  }

  .local-video {
    height: 150px;
  }

  .controls {
    gap: 15px;
  }

  .btn {
    min-width: 100px;
    padding: 10px 20px;
    font-size: 0.9rem;
  }

  .incoming-call-modal {
    margin: 20px;
    padding: 30px 20px;
  }

  .incoming-call-controls {
    flex-direction: column;
    gap: 15px;
  }
}
</style>
