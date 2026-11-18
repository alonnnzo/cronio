// Pruebas 0.3 a 0.6 en un solo programa: red, LED, reposo y micrófono.
//
//   - Escucha TCP en el puerto 33334 (el PC se conecta a la consola) y responde los pings.
//   - Escucha avisos UDP por difusión en el puerto 33333.
//   - X: intenta la conexión inversa, de la consola al PC (PC_IP:33336).
//   - A: cambia el patrón del LED de aviso.
//   - R mantenido: captura el micrófono a 16364 Hz y lo envía al PC.
//   - START: salir.
//
// Tramas: [tipo: 1 byte][largo: 2 bytes, little endian][contenido]
#include <3ds.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <malloc.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define SOC_ALIGN 0x1000
#define SOC_BUFFERSIZE 0x100000
#define TCP_PORT 33334
#define UDP_PORT 33333
#define PC_PORT 33336
static const char *PC_IP = "192.168.0.10";

enum { F_TEXT = 1, F_AUDIO = 2, F_PING = 3, F_PONG = 4 };

static int listenSock = -1, client = -1, udpSock = -1, outSock = -1;
static u8 rxbuf[4096];
static u32 rxlen = 0;
static u32 conns = 0, pings = 0, beacons = 0, wakeups = 0, audioBytes = 0, sendFails = 0;
static char lastText[40] = "-", beaconFrom[20] = "-", outState[28] = "sin probar", ledState[28] = "apagado";
static u64 outStarted = 0;
static int listenErr = 0;
static u8 micGain = 0;

static void setNonBlocking(int s) { fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK); }

static bool sendAll(int s, const u8 *buf, u32 len) {
	u32 sent = 0, tries = 0;
	while (sent < len) {
		int n = send(s, buf + sent, len - sent, 0);
		if (n > 0) { sent += n; tries = 0; continue; }
		if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) && tries++ < 200) { svcSleepThread(1000000ULL); continue; }
		sendFails++;
		return false;
	}
	return true;
}

static bool sendFrame(int s, u8 type, const void *payload, u16 len) {
	u8 head[3] = { type, (u8)(len & 0xff), (u8)(len >> 8) };
	return sendAll(s, head, 3) && (len == 0 || sendAll(s, payload, len));
}

static void closeSock(int *s) { if (*s >= 0) { close(*s); *s = -1; } }

static void openSockets(void) {
	struct sockaddr_in a;
	memset(&a, 0, sizeof a);
	a.sin_family = AF_INET;
	a.sin_addr.s_addr = INADDR_ANY;

	listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
	a.sin_port = htons(TCP_PORT);
	int yes = 1;
	if (listenSock >= 0) setsockopt(listenSock, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
	listenErr = 0;
	if (listenSock >= 0 && (bind(listenSock, (struct sockaddr *)&a, sizeof a) < 0 || listen(listenSock, 1) < 0)) { listenErr = errno; closeSock(&listenSock); }
	if (listenSock >= 0) setNonBlocking(listenSock);

	udpSock = socket(AF_INET, SOCK_DGRAM, 0);
	a.sin_port = htons(UDP_PORT);
	if (udpSock >= 0 && bind(udpSock, (struct sockaddr *)&a, sizeof a) < 0) closeSock(&udpSock);
	if (udpSock >= 0) setNonBlocking(udpSock);
}

static void closeAll(void) { closeSock(&client); closeSock(&listenSock); closeSock(&udpSock); closeSock(&outSock); rxlen = 0; }

static void handleFrame(u8 type, const u8 *p, u16 len) {
	if (type == F_PING) { pings++; sendFrame(client, F_PONG, p, len); }
	else if (type == F_TEXT) { u16 n = len < sizeof lastText - 1 ? len : sizeof lastText - 1; memcpy(lastText, p, n); lastText[n] = 0; }
}

static void pumpNetwork(void) {
	if (client < 0 && listenSock >= 0) {
		struct sockaddr_in c; socklen_t cl = sizeof c;
		int s = accept(listenSock, (struct sockaddr *)&c, &cl);
		if (s >= 0) { client = s; setNonBlocking(client); conns++; rxlen = 0; }
	}
	if (client >= 0) {
		int n = recv(client, rxbuf + rxlen, sizeof rxbuf - rxlen, 0);
		if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) closeSock(&client);
		else if (n > 0) {
			rxlen += n;
			while (rxlen >= 3) {
				u16 len = rxbuf[1] | (rxbuf[2] << 8);
				if (len > sizeof rxbuf - 3) { closeSock(&client); rxlen = 0; break; }
				if (rxlen < 3u + len) break;
				handleFrame(rxbuf[0], rxbuf + 3, len);
				memmove(rxbuf, rxbuf + 3 + len, rxlen - 3 - len);
				rxlen -= 3 + len;
			}
		}
	}
	if (udpSock >= 0) {
		char buf[128]; struct sockaddr_in from; socklen_t fl = sizeof from;
		int n = recvfrom(udpSock, buf, sizeof buf, 0, (struct sockaddr *)&from, &fl);
		if (n > 0) { beacons++; snprintf(beaconFrom, sizeof beaconFrom, "%s", inet_ntoa(from.sin_addr)); }
	}
	if (outSock >= 0) {
		// poll + SO_ERROR dieron un falso "fallo" aunque el PC recibió la conexión:
		// se intenta enviar hasta que la conexión esté lista o pasen 4 s.
		const char *msg = "hola desde la 3DS (conexion saliente)";
		u8 buf[64];
		u16 len = strlen(msg);
		buf[0] = F_TEXT; buf[1] = len & 0xff; buf[2] = len >> 8;
		memcpy(buf + 3, msg, len);
		int n = send(outSock, buf, 3 + len, 0);
		if (n > 0) { snprintf(outState, sizeof outState, "OK (%llu ms)", osGetTime() - outStarted); closeSock(&outSock); }
		else if (osGetTime() - outStarted > 4000) { snprintf(outState, sizeof outState, "FALLO (errno %d)", errno); closeSock(&outSock); }
	}
}

static void startOutbound(void) {
	closeSock(&outSock);
	struct sockaddr_in a;
	memset(&a, 0, sizeof a);
	a.sin_family = AF_INET; a.sin_port = htons(PC_PORT); a.sin_addr.s_addr = inet_addr(PC_IP);
	outSock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
	if (outSock < 0) { snprintf(outState, sizeof outState, "FALLO (socket)"); return; }
	setNonBlocking(outSock);
	outStarted = osGetTime();
	int r = connect(outSock, (struct sockaddr *)&a, sizeof a);
	if (r < 0 && errno != EINPROGRESS) { snprintf(outState, sizeof outState, "FALLO (error %d)", errno); closeSock(&outSock); }
	else snprintf(outState, sizeof outState, "conectando...");
}

// ---- LED de aviso ----
static bool ledReady = false;
static Result ledInitRes = 0;
static void setLed(int mode) {
	static const char *names[] = { "apagado", "amarillo intermitente", "verde fijo", "rojo intermitente", "cian pulsante" };
	static const u8 rgb[5][3] = { {0,0,0}, {255,180,0}, {0,255,60}, {255,0,0}, {0,200,255} };
	MCU_InfoLedPattern p;
	memset(&p, 0, sizeof p);
	p.animation.ticksPerFrame = mcuTicksFromMs(40);
	p.animation.frameTransitionDelay = mode == 4 ? p.animation.ticksPerFrame : 0;
	for (int i = 0; i < 32; i++) {
		bool on = (mode == 2) || (mode == 1 || mode == 3 ? i < 16 : false);
		u8 k = mode == 4 ? (u8)(i < 16 ? i * 16 : (31 - i) * 16) : (on ? 255 : 0);
		p.redPattern[i] = rgb[mode][0] * k / 255; p.greenPattern[i] = rgb[mode][1] * k / 255; p.bluePattern[i] = rgb[mode][2] * k / 255;
	}
	if (!ledReady) { snprintf(ledState, sizeof ledState, "sin acceso (%08lX)", (unsigned long)ledInitRes); return; }
	Result r = MCUHWC_SetInfoLedPattern(&p);
	if (R_FAILED(r)) snprintf(ledState, sizeof ledState, "error %08lX", (unsigned long)r);
	else snprintf(ledState, sizeof ledState, "%s", names[mode]);
}

int main(void) {
	gfxInitDefault();
	PrintConsole top, bottom;
	consoleInit(GFX_TOP, &top);
	consoleInit(GFX_BOTTOM, &bottom);

	u32 *socBuf = memalign(SOC_ALIGN, SOC_BUFFERSIZE);
	Result socRes = socBuf ? socInit(socBuf, SOC_BUFFERSIZE) : -1;
	if (R_SUCCEEDED(socRes)) openSockets();

	ledInitRes = mcuHwcInit();
	ledReady = R_SUCCEEDED(ledInitRes);

	u32 micSize = 0x30000;
	u8 *micBuf = memalign(0x1000, micSize);
	Result micRes = micBuf ? micInit(micBuf, micSize) : -1;
	u32 micData = R_SUCCEEDED(micRes) ? micGetSampleDataSize() : 0, micPos = 0;
	bool recording = false;
	if (micData) MICU_GetGain(&micGain);
	static u8 chunk[2048];

	consoleSelect(&top);
	struct in_addr me = { .s_addr = gethostid() };
	printf("\x1b[1;1H3DS Agent Companion - pruebas 0.3 a 0.6");
	printf("\x1b[3;1HIP de la consola: %s", inet_ntoa(me));
	printf("\x1b[4;1HEscucha TCP %d y UDP %d", TCP_PORT, UDP_PORT);
	printf("\x1b[5;1Hsoc %08lX  mic %08lX  led %08lX", (unsigned long)socRes, (unsigned long)micRes, (unsigned long)ledInitRes);
	printf("\x1b[8;1HA      cambia el LED de aviso");
	printf("\x1b[9;1HX      conexion inversa: consola -> PC %s", PC_IP);
	printf("\x1b[10;1HR      mantener para grabar y enviar el microfono");
	printf("\x1b[11;1HTapa   cerrar 10 s y abrir para probar el reposo");
	printf("\x1b[12;1HArriba/Abajo  ganancia del microfono (+10 / -10)");
	printf("\x1b[13;1HSTART  salir");

	int ledMode = 0;
	u64 last = osGetTime();
	u32 frame = 0;
	while (aptMainLoop()) {
		gspWaitForVBlank();
		hidScanInput();
		u32 down = hidKeysDown(), held = hidKeysHeld(), up = hidKeysUp();
		if (down & KEY_START) break;

		// Vuelta del reposo: los sockets quedan inservibles, se abren de nuevo.
		u64 now = osGetTime();
		if (now - last > 2000 && R_SUCCEEDED(socRes)) { wakeups++; closeAll(); openSockets(); }
		last = now;

		if (R_SUCCEEDED(socRes)) pumpNetwork();
		if (down & KEY_A) { ledMode = (ledMode + 1) % 5; setLed(ledMode); }
		if ((down & KEY_X) && R_SUCCEEDED(socRes)) startOutbound();

		if (micData) {
			if ((down & KEY_R) && R_SUCCEEDED(MICU_StartSampling(MICU_ENCODING_PCM16_SIGNED, MICU_SAMPLE_RATE_16360, 0, micData, true))) { recording = true; micPos = 0; audioBytes = 0; }
			if (recording && (held & KEY_R)) {
				u32 end = micGetLastSampleOffset() & ~1u;
				while (micPos != end) {
					u32 n = 0;
					while (micPos != end && n < sizeof chunk) { chunk[n++] = micBuf[micPos]; micPos = (micPos + 1) % micData; }
					audioBytes += n;
					if (client >= 0 && !sendFrame(client, F_AUDIO, chunk, n)) break;
				}
			}
			if (recording && (up & KEY_R)) {
				MICU_StopSampling(); recording = false;
				char t[28]; int tl = snprintf(t, sizeof t, "mic_end ganancia=%u", micGain);
				if (client >= 0) sendFrame(client, F_TEXT, t, tl);
			}
			if (!recording && (down & (KEY_DUP | KEY_DDOWN))) {
				int g = micGain + ((down & KEY_DUP) ? 10 : -10);
				if (g < 0) g = 0;
				if (g > 250) g = 250;
				if (R_SUCCEEDED(MICU_SetGain((u8)g))) MICU_GetGain(&micGain);
			}
		}

		if (frame++ % 10 == 0) {
			consoleSelect(&bottom);
			printf("\x1b[1;1HPC conectado : %-3s (conexiones: %lu)\x1b[K", client >= 0 ? "SI" : "no", (unsigned long)conns);
			printf("\x1b[2;1HPings        : %lu\x1b[K", (unsigned long)pings);
			printf("\x1b[3;1HUltimo texto : %s\x1b[K", lastText);
			printf("\x1b[5;1HAvisos UDP   : %lu de %s\x1b[K", (unsigned long)beacons, beaconFrom);
			printf("\x1b[7;1HConsola->PC  : %s\x1b[K", outState);
			printf("\x1b[9;1HLED          : %s\x1b[K", ledState);
			printf("\x1b[11;1HMicrofono    : %s %lu bytes, ganancia %u\x1b[K", recording ? "GRABANDO" : "en espera", (unsigned long)audioBytes, micGain);
			printf("\x1b[15;1HEscucha TCP  : %s (errno %d)\x1b[K", listenSock >= 0 ? "ok" : "FALLO", listenErr);
			printf("\x1b[13;1HReposos      : %lu\x1b[K", (unsigned long)wakeups);
			printf("\x1b[14;1HEnvios fallidos: %lu\x1b[K", (unsigned long)sendFails);
		}
	}

	if (ledReady) { setLed(0); mcuHwcExit(); }
	if (R_SUCCEEDED(micRes)) micExit();
	closeAll();
	if (R_SUCCEEDED(socRes)) socExit();
	gfxExit();
	return 0;
}
