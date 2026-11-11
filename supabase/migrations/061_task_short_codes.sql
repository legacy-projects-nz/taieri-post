-- Driver task rows: short title and access code (shown on one compact row; the full name and note stay for admin)
alter table public.timing_rules add column if not exists short text, add column if not exists code text;
update public.timing_rules r set short = v.s from (values
 ('tw3rdparty','3rd Party'),('twairmail','Air mail'),('t11','Airport rcv'),('t6','Bal depot'),('baynext','Bay/next'),('t5','Game plan'),
 ('t15','Digi Art'),('t3','Fish'),('twlawmail','Mailbox'),('pulaw','Lawrence PU'),('lawtrays','Mail trays'),('twtrays','Trays WA'),
 ('t10','Milton meet'),('t9','Milton meet'),('twmissorts','Missorts'),('twmvt70onw','Momona box'),('twfbam','No scan <11:50'),('twfbpm','No scan <2:50'),
 ('twnzcph','NZC/PH PU'),('t16','Outram drop'),('puowaka','Owaka PU'),('owakadepot','Owaka depot'),('t8','Med → Bal'),('t7','Owaka Med'),
 ('t2','Game plan'),('twairkeys','Air keys'),('twrcvkey','Rcv key'),('t14','PC rcv'),('t12','Rose rcv'),('t1','Game plan'),('twrunsheet','Runsheet'),
 ('t13','SB rcv'),('pusouth','South PU'),('telford','Telford'),('twtidybay','Tidy bay'),('twtidydesk','Tidy desk'),('traysback','Trays back')
) as v(id, s) where r.id = v.id;
update public.timing_rules set code = '1470Y → R' where id = 't6';
update public.timing_rules set code = 'C4566X' where id = 'owakadepot';
notify pgrst, 'reload schema';
