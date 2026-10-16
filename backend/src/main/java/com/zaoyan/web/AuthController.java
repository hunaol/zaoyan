package com.zaoyan.web;

import com.zaoyan.auth.TokenService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AuthController {
    private final TokenService tokens;
    public AuthController(TokenService tokens){this.tokens=tokens;}
    public record Login(@NotBlank String username,@NotBlank String password){}
    @GetMapping("/health") public Map<String,String> health(){return Map.of("status","ok","service","灶眼 AI");}
    @PostMapping("/auth/login") public Object login(@Valid @RequestBody Login l){
        String token=tokens.login(l.username(),l.password());
        var s=tokens.inspect(token);
        return Map.of("token",token,"username",s.username(),"role",s.role(),"expiresAt",s.expiresAt());
    }
    @GetMapping("/auth/me") public Object me(Authentication auth){return Map.of("username",auth.getName(),"role",auth.getAuthorities().iterator().next().getAuthority().replace("ROLE_",""));}
    @PostMapping("/auth/logout") public ResponseEntity<?> logout(@RequestHeader(value="Authorization",required=false) String h){
        tokens.logout(h!=null&&h.startsWith("Bearer ")?h.substring(7):null);return ResponseEntity.noContent().build();
    }
}
