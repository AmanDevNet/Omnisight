print("TEST STARTED")

from scapy.all import get_if_list

print("Available Interfaces:")
print(get_if_list())