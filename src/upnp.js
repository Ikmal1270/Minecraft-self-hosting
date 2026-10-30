// Minimal UPnP IGD client: asks the home router to forward the Minecraft port.
// Works on most consumer routers that have UPnP enabled.
const dgram = require('dgram');
const { request, fetchText } = require('./net');

const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

function discover(timeout = 3000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const locations = new Set();
    socket.on('message', (msg) => {
      const m = msg.toString().match(/^location:\s*(.+)$/im);
      if (m) locations.add(m[1].trim());
    });
    socket.on('error', () => { /* ignore */ });
    socket.bind(() => {
      for (const st of SEARCH_TARGETS) {
        const packet = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\n' +
          `MX: 2\r\nST: ${st}\r\n\r\n`);
        socket.send(packet, 1900, '239.255.255.250');
      }
    });
    setTimeout(() => {
      try { socket.close(); } catch (e) { /* ignore */ }
      resolve([...locations]);
    }, timeout);
  });
}

async function findControl(location) {
  const xml = await fetchText(location, { timeout: 5000 });
  const base = (xml.match(/<URLBase>([^<]+)<\/URLBase>/i) || [])[1] || location;
  const services = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (const svc of services) {
    const type = (svc.match(/<serviceType>([^<]+)<\/serviceType>/i) || [])[1] || '';
    if (!/WAN(IP|PPP)Connection/.test(type)) continue;
    const control = (svc.match(/<controlURL>([^<]+)<\/controlURL>/i) || [])[1];
    if (control) return { url: new URL(control.trim(), base).toString(), serviceType: type.trim() };
  }
  return null;
}

async function soap(control, action, args = {}) {
  const argXml = Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="${control.serviceType}">${argXml}</u:${action}></s:Body></s:Envelope>`;
  const res = await request(control.url, {
    method: 'POST',
    body,
    timeout: 6000,
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${control.serviceType}#${action}"`,
      'Content-Length': Buffer.byteLength(body),
    },
  });
  let text = '';
  for await (const chunk of res) text += chunk;
  if (res.statusCode !== 200) {
    const desc = (text.match(/<errorDescription>([^<]+)</i) || [])[1];
    throw new Error(desc || `Router rejected ${action} (HTTP ${res.statusCode})`);
  }
  return text;
}

// The LAN address the router sees us on (route-based, not just "first adapter").
function localAddressFor(host) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.connect(1900, host, () => {
      const addr = s.address().address;
      s.close();
      resolve(addr);
    });
    s.on('error', reject);
  });
}

let gateway = null;
async function getGateway() {
  if (gateway) return gateway;
  const locations = await discover();
  for (const loc of locations) {
    try {
      const control = await findControl(loc);
      if (control) {
        gateway = { ...control, host: new URL(loc).hostname };
        return gateway;
      }
    } catch (e) { /* try next device */ }
  }
  throw new Error('No UPnP router found. Enable UPnP in your router settings, or forward the port manually.');
}

async function openPort(port, description = 'DIY MC Hosting Minecraft') {
  const gw = await getGateway();
  const internal = await localAddressFor(gw.host);
  for (const proto of ['TCP', 'UDP']) {
    await soap(gw, 'AddPortMapping', {
      NewRemoteHost: '',
      NewExternalPort: port,
      NewProtocol: proto,
      NewInternalPort: port,
      NewInternalClient: internal,
      NewEnabled: 1,
      NewPortMappingDescription: description,
      NewLeaseDuration: 0,
    });
  }
  let externalIp = null;
  try {
    const xml = await soap(gw, 'GetExternalIPAddress');
    externalIp = (xml.match(/<NewExternalIPAddress>([^<]+)</i) || [])[1] || null;
  } catch (e) { /* optional */ }
  return { success: true, internal, externalIp, router: gw.host };
}

async function closePort(port) {
  const gw = await getGateway();
  for (const proto of ['TCP', 'UDP']) {
    try {
      await soap(gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto });
    } catch (e) { /* mapping may not exist */ }
  }
  return { success: true };
}

module.exports = { openPort, closePort };
