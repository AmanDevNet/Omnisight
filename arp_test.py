from scapy.all import ARP, Ether, srp

target = "172.21.160.0/20"

arp = ARP(pdst=target)
ether = Ether(dst="ff:ff:ff:ff:ff:ff")

packet = ether/arp

result = srp(packet, timeout=3, verbose=0)[0]

for sent, received in result:
    print(f"IP: {received.psrc}  MAC: {received.hwsrc}")