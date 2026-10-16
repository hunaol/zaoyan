package com.zaoyan.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class TokenService {
    public record Session(String username,String role,Instant expiresAt) {}
    private final Map<String,Session> sessions = new ConcurrentHashMap<>();
    private final PasswordEncoder encoder;
    private final String demoUser, operatorUser, adminHash, operatorHash;
    private final SecureRandom random = new SecureRandom();
    public TokenService(PasswordEncoder encoder,
            @Value("${app.demo-username}") String demoUser,
            @Value("${app.demo-password}") String demoPassword,
            @Value("${app.operator-username:operator}") String operatorUser,
            @Value("${app.operator-password:Operator@2026}") String operatorPassword) {
        this.encoder=encoder;this.demoUser=demoUser;this.operatorUser=operatorUser;
        this.adminHash=encoder.encode(demoPassword);this.operatorHash=encoder.encode(operatorPassword);
    }
    public String login(String username,String password) {
        String role = null;
        if (demoUser.equals(username) && encoder.matches(password,adminHash)) role="ADMIN";
        if (operatorUser.equals(username) && encoder.matches(password,operatorHash)) role="OPERATOR";
        if (role==null) throw new IllegalArgumentException("账号或密码错误");
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        sessions.put(token,new Session(username,role,Instant.now().plusSeconds(12*3600)));
        return token;
    }
    public Session inspect(String token) {
        if (token==null) return null;
        Session s=sessions.get(token);
        if (s!=null && s.expiresAt().isBefore(Instant.now())) { sessions.remove(token); return null; }
        return s;
    }
    public void logout(String token){ if(token!=null) sessions.remove(token); }
}
