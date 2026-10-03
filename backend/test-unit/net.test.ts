import { strict as assert } from 'node:assert';
import { intToIp, ipToInt, mustCidr } from '../src/modules/nodes/nodes.service';

export function testNet() {
  // normalization to network address
  assert.equal(mustCidr('10.201.7.9/16'), '10.201.0.0/16');
  assert.equal(mustCidr('  192.168.1.0/24  '), '192.168.1.0/24');
  // rejections (message carries the reason; code travels in AppError.code)
  for (const bad of ['10.0.0.0/7', '10.0.0.0/25', '10.0.0.0', '999.1.1.0/16', '0.0.0.0/8', '127.0.0.0/8', '224.0.0.0/8', '', 'abc']) {
    assert.throws(() => mustCidr(bad), /CIDR|unicast/, bad || '(empty)');
  }
  // ip round-trip incl. 32-bit boundaries
  for (const ip of ['0.0.0.1', '10.201.0.0', '172.16.255.255', '255.255.255.255']) {
    assert.equal(intToIp(ipToInt(ip)), ip);
  }
  assert.equal(ipToInt('10.201.0.0') + 256, ipToInt('10.201.1.0'));
}
