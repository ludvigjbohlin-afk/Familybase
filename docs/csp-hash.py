import re,hashlib,base64,sys
P=sys.argv[1] if len(sys.argv)>1 else "/mnt/user-data/outputs/household-balance-cloud.html"
s=open(P,encoding="utf-8").read()
inl=re.findall(r"<script>(.*?)</script>",s,re.S)
assert len(inl)==1,len(inl)
h="sha256-"+base64.b64encode(hashlib.sha256(inl[0].encode("utf-8")).digest()).decode()
s2,n=re.subn(r"'sha256-[^']*'","'"+h+"'",s,count=1)
assert n==1
open(P,"w",encoding="utf-8").write(s2); print(h)
